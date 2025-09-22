const drivers = require("./drivers");
const terminals = require("./terminals");
const programs = require("./programs");
const files = require("./files");
const playing = require("./playing");
const device = require("./device");
const connectivity = require("./connectivity");
const statusTracking = require("./statusTracking");
const media = require("./media");
const gps = require("./gps");
const parser = require("./parser");
const registration = require("./registration");

module.exports = {
  // drivers
  ...drivers,
  // terminals
  ...terminals,
  // programs
  ...programs,
  // files
  ...files,
  // playing
  ...playing,
  // device status
  ...device,
  // connectivity
  ...connectivity,
  // status tracking
  ...statusTracking,
  // media
  ...media,
  // gps
  ...gps,
  // parser utilities
  ...parser,
  // registration workflow
  ...registration,
};
