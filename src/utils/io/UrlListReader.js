const URL_REGEX = /(https?:\/\/\S+)/;

class UrlListReader {
  constructor() {
    if (!UrlListReader.instance) {
      UrlListReader.instance = this;
    }
    return UrlListReader.instance;
  }

  async read(filePath) {
    const text = await Bun.file(filePath).text();
    const urls = [];
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      if (line === "" || line.startsWith("#")) {
        continue;
      }
      const match = URL_REGEX.exec(line);
      if (match) {
        urls.push(match[1]);
      }
    }
    return urls;
  }
}

export const urlListReader = new UrlListReader();
