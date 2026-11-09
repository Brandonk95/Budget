// Reads release.json (bundled into the image) for the version + message of the day.
function info() {
  try {
    const raw = toString($os.readFile(`${__hooks}/../release.json`));
    const r = JSON.parse(raw);
    return { version: String(r.version || "0.0.0"), released: String(r.released || ""), motd: String(r.motd || "") };
  } catch (_) {
    return { version: "dev", released: "", motd: "" };
  }
}
module.exports = { info };
