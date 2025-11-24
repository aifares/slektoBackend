# 🔄 New File Sync Flow

## 📋 Architecture Change

### ❌ **Old Flow (Before):**
1. **Poller** sees terminal data → **INSERTS** files with `program_id`, `client_id=null`
2. **Media Sync** enriches existing files → **UPDATES** with `client_id`, `title`

**Problem:** Poller was the source of truth for files, but it doesn't have client/title info

---

### ✅ **New Flow (After):**
1. **Media Sync** fetches from ColorLight → **INSERTS** files with `client_id`, `title`, `program_id=null`
2. **Poller** sees terminal data → **UPDATES** files with `program_id`

**Benefit:** ColorLight is the single source of truth for media files

---

## 🎯 Flow Diagram

```
ColorLight Media Endpoint
    │
    │ (Daily 2am or manual sync)
    ▼
┌─────────────────────┐
│   Media Sync        │
│  - Fetches all      │
│  - Parses tags      │
│  - INSERTS files    │
└─────────────────────┘
    │
    │ Creates files with:
    │  ✅ client_id (from tags)
    │  ✅ title (from tags)
    │  ✅ source_url
    │  ✅ custom_tags
    │  ❌ program_id (null)
    ▼
┌─────────────────────┐
│   Files Table       │
│  program_id: null   │
│  client_id: 5       │
│  title: "Lava"      │
└─────────────────────┘
    │
    │ (Every 3 minutes)
    ▼
┌─────────────────────┐
│   Poller            │
│  - Fetches terminal │
│  - Finds files      │
│  - UPDATES files    │
└─────────────────────┘
    │
    │ Adds program association:
    │  ✅ program_id (from terminal)
    ▼
┌─────────────────────┐
│   Files Table       │
│  program_id: 2620340│ ← Added by poller
│  client_id: 5       │
│  title: "Lava"      │
└─────────────────────┘
```

---

## 🔧 Changes Made

### 1. **mediaSync.js**
```javascript
// OLD: Only update existing files, skip new ones
if (existingFileMap[file.name]) {
  toUpdate.push(...);
} else {
  skipped.push(file.name); // Don't insert
}

// NEW: Insert files that don't exist yet
if (existingFileMap[file.name]) {
  toUpdate.push(...);
} else {
  toInsert.push({
    ...file,
    program_id: null  // Will be added by poller
  });
}
```

### 2. **registration.js**
```javascript
// OLD: Insert files with program_id
await batchInsertFiles(parsedData.files);

// NEW: Update existing files with program_id
async function updateFilesWithProgramId(files) {
  // Look up file by name
  // If exists: update program_id
  // If not exists: skip (media sync will add it)
}
```

### 3. **Migration: 010_make_program_id_nullable.sql**
```sql
-- Allow program_id to be NULL
ALTER TABLE files 
ALTER COLUMN program_id DROP NOT NULL;

-- Update unique constraints
CREATE UNIQUE INDEX files_name_null_program_unique 
ON files(name) 
WHERE program_id IS NULL;
```

---

## 📝 Migration Required

**Before testing, apply this migration in Supabase:**

File: `APPLY_MIGRATION_010.sql`

This makes `program_id` nullable so media sync can insert files without it.

---

## ✅ Benefits

1. **Single Source of Truth**
   - ColorLight media endpoint is authoritative for files
   - All file metadata comes from ColorLight

2. **Cleaner Separation**
   - Media sync: Handles file metadata (client_id, title, tags)
   - Poller: Handles program associations only

3. **Better Error Handling**
   - If poller fails, files still exist with metadata
   - If media sync fails, existing files keep their program associations

4. **Consistent Data**
   - Title and client_id always come from ColorLight tags
   - No mixing of data sources

---

## 🧪 Testing Checklist

- [ ] Apply migration `APPLY_MIGRATION_010.sql`
- [ ] Restart server
- [ ] Run media sync (POST /admin/sync-media)
- [ ] Verify files inserted with program_id = null
- [ ] Wait for poller or trigger it
- [ ] Verify files updated with program_id
- [ ] Check Share of Voice works

---

## 🎯 Expected Behavior

### After Media Sync:
```sql
SELECT name, client_id, title, program_id FROM files;
-- F_xxx.png | 5 | "Lava" | NULL
```

### After Poller:
```sql
SELECT name, client_id, title, program_id FROM files;
-- F_xxx.png | 5 | "Lava" | 2620340
```

---

## 📊 Monitoring

**Check files waiting for program association:**
```sql
SELECT COUNT(*) 
FROM files 
WHERE program_id IS NULL 
  AND client_id IS NOT NULL;
```

**Check files fully synced:**
```sql
SELECT COUNT(*) 
FROM files 
WHERE program_id IS NOT NULL 
  AND client_id IS NOT NULL;
```

