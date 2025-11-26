# Check if Client is Admin API

## Endpoint

```
GET /clients/me/is-admin
```

## Authentication

Requires valid Supabase access token via:

- Header: `Authorization: Bearer <token>`
- Cookie: `sb-access-token=<token>`

## Response

```json
{
  "isAdmin": true,
  "role": "admin",
  "clientId": 123,
  "clientName": "John Doe"
}
```

## Fields

| Field        | Type    | Description                                  |
| ------------ | ------- | -------------------------------------------- |
| `isAdmin`    | boolean | `true` if role is "admin", `false` otherwise |
| `role`       | string  | Client's role (e.g., "admin", "user")        |
| `clientId`   | number  | Client's database ID                         |
| `clientName` | string  | Client's display name                        |

## Example Usage

**cURL:**

```bash
curl http://localhost:3000/clients/me/is-admin \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**JavaScript (fetch):**

```javascript
const response = await fetch("http://localhost:3000/clients/me/is-admin", {
  headers: {
    Authorization: `Bearer ${accessToken}`,
  },
});
const data = await response.json();

if (data.isAdmin) {
  console.log("User is an admin");
}
```

## Setting Admin Role

Update the `role` field in the `client` table:

```sql
UPDATE client
SET role = 'admin'
WHERE email = 'user@example.com';
```

## Error Responses

- `401 Unauthorized` - Missing or invalid token
- `403 Forbidden` - No client account found
- `500 Internal Server Error` - Server error
