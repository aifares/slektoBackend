async function fetchMediaByProgramId(programId) {
  try {
    const { AUTH_HEADER } = require("../utils");
    const axios = require("axios");

    const mediaUrl = "https://us33.colorlightcloud.com/wp-json/wp/v2/media";

    const response = await axios.get(mediaUrl, {
      ...AUTH_HEADER,
      params: {
        page: 1,
        per_page: 50,
        flag: "filter",
      },
    });

    if (!response.data || !Array.isArray(response.data)) {
      console.warn(`No media data found for program ${programId}`);
      return [];
    }

    const programMedia = response.data.filter((media) => {
      if (
        !media.attachment_program ||
        !Array.isArray(media.attachment_program)
      ) {
        return false;
      }
      return media.attachment_program.some(
        (program) => program.id === programId
      );
    });

    const programFiles = programMedia
      .filter((media) => {
        return (
          media.mime_type === "image/png" &&
          media.media_details?.sizes?.thumbnail?.source_url
        );
      })
      .map((media) => ({
        name: media.name,
        total: media.attachment_filesize || 0,
        programId: programId,
        downloaded: media.attachment_filesize || 0,
        thumbnail_url: media.media_details.sizes.thumbnail.source_url,
        full_url: media.source_url,
        media_id: media.id,
        title: media.title?.rendered || media.title_raw || media.name,
      }));

    console.log(
      `📸 Found ${programFiles.length} media files for program ${programId}`
    );
    return programFiles;
  } catch (error) {
    console.error(
      `Error fetching media for program ${programId}:`,
      error.message
    );
    return [];
  }
}

module.exports = {
  fetchMediaByProgramId,
};
