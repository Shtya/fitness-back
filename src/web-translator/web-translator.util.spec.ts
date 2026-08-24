import {
  detectLang,
  hashPairingCode,
  isSingleWord,
  normalizeLookupText,
  parseAiEnrichment,
  parseDictionaryEntry,
  uniquenessKey,
} from "./web-translator.util";

describe("web-translator.util", () => {
  it("normalizes whitespace and strips soft hyphens", () => {
    expect(normalizeLookupText("  hello\u00ad\nworld  ")).toBe("hello world");
  });

  it("caps text length", () => {
    expect(normalizeLookupText("a".repeat(600)).length).toBe(500);
  });

  it("detects Arabic vs English", () => {
    expect(detectLang("مرحبا")).toBe("ar");
    expect(detectLang("hello")).toBe("en");
  });

  it("treats latin uniqueness as case-insensitive and Arabic as exact", () => {
    expect(uniquenessKey("Hello")).toBe("hello");
    expect(uniquenessKey("مرحبا")).toBe("مرحبا");
  });

  it("detects single words vs phrases", () => {
    expect(isSingleWord("balance")).toBe(true);
    expect(isSingleWord("heart rate")).toBe(false);
  });

  it("hashes pairing codes consistently", () => {
    expect(hashPairingCode("ab12cd34")).toBe(hashPairingCode("AB12CD34"));
    expect(hashPairingCode("AAAA")).not.toBe(hashPairingCode("BBBB"));
  });

  it("reads dictionaryapi.dev payloads", () => {
    const parsed = parseDictionaryEntry([
      {
        phonetic: "/həˈləʊ/",
        meanings: [
          {
            partOfSpeech: "exclamation",
            definitions: [{ example: "hello there" }],
          },
        ],
      },
    ]);
    expect(parsed.pronunciation).toBe("/həˈləʊ/");
    expect(parsed.partOfSpeech).toBe("exclamation");
    expect(parsed.example).toBe("hello there");
  });

  it("parses AI JSON even when wrapped in prose", () => {
    const parsed = parseAiEnrichment(
      'Here you go:\n{"pronunciation":"hi","partOfSpeech":"noun","example":"hi there"}',
    );
    expect(parsed.partOfSpeech).toBe("noun");
    expect(parsed.example).toBe("hi there");
  });
});
