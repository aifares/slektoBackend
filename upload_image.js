const axios = require("axios");
const fs = require("fs");
const FormData = require("form-data");
const path = require("path");

const COLORLIGHT_AUTH = "Basic QWxpRmFyZXM6SHgxMjM0NTZAIw==";

async function uploadImage() {
  const imagePath = path.join(__dirname, "testImage.jpg");

  if (!fs.existsSync(imagePath)) {
    console.error("Image not found:", imagePath);
    process.exit(1);
  }

  const form = new FormData();

  // Add the file
  form.append("file", fs.createReadStream(imagePath), {
    filename: "testImage.jpg",
    contentType: "image/jpeg",
  });

  // Add the uploadURI if needed (from your curl command)
  // form.append('uploadURI', 'b65c47a5-8455-4560-8883-306328dce539');

  try {
    const response = await axios.post(
      "https://us33.colorlightcloud.com/wp-json/wp/v2/media?title=Screenshot%202026-01-21%20at%2011.30.40%E2%80%AFPM.png",
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: COLORLIGHT_AUTH,
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
          Referer: "https://us33.colorlightcloud.com/media",
          Accept: "application/json, text/plain, */*",
        },
      },
    );

    console.log("Upload successful!");
    console.log("Response:", JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error("Upload failed:", error.message);
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Data:", error.response.data);
    }
  }
}

uploadImage();
