const AWS = require("aws-sdk");
const fs = require("fs");

const ID = "AKIAJP5PRI4VPXIEFIVA";
const SECRET = "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";

const BUCKET_NAME = "riders-central/Profiles_pictures";

const s3 = new AWS.S3({
  accessKeyId: ID,
  secretAccessKey: SECRET,
});

const uploadFile = (fileName) => {
  // Read content from the file
  const fileContent = fs.readFileSync(fileName);

  // Setting up S3 upload parameters
  const params = {
    Bucket: BUCKET_NAME,
    Key: "flowers.jpeg", // File name you want to save as in S3
    Body: fileContent,
  };

  // Uploading files to the bucket
  s3.upload(params, function (err, data) {
    if (err) {
      throw err;
    }
    console.log(`File uploaded successfully. ${data.Location}`);
  });
};

//? Test
uploadFile("flowers.jpeg");
