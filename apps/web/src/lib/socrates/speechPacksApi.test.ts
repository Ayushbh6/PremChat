import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SOCRATES_SPEECH_PACK_CATALOG,
  SocratesSpeechPackApiError,
  socratesSpeechPacksApi,
  type SocratesSpeechPack,
} from "./speechPacksApi";

const pack = (id: SocratesSpeechPack["id"], installed = false): SocratesSpeechPack => ({
  id,
  installed,
  verified: installed,
  path: `/tmp/speech/${id}`,
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Socrates speech-pack API", () => {
  it("parses the three explicit offline packs and exposes their real download sizes", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      ok: true,
      data: {
        packs: [
          pack("whisper-base.en"),
          pack("whisper-small.en", true),
          pack("kokoro-en-v0_19"),
        ],
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(socratesSpeechPacksApi.list()).resolves.toMatchObject([
      { id: "whisper-base.en", verified: false },
      { id: "whisper-small.en", verified: true },
      { id: "kokoro-en-v0_19", verified: false },
    ]);
    expect(SOCRATES_SPEECH_PACK_CATALOG["whisper-base.en"].sizeBytes).toBe(147_964_211);
    expect(SOCRATES_SPEECH_PACK_CATALOG["whisper-small.en"].sizeBytes).toBe(487_614_201);
    expect(SOCRATES_SPEECH_PACK_CATALOG["kokoro-en-v0_19"].sizeBytes).toBe(319_625_534);
  });

  it("uses only the explicit local install and remove routes", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: { pack: pack("whisper-base.en", true) } }))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        data: { removedPackId: "whisper-base.en", pack: pack("whisper-base.en") },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await socratesSpeechPacksApi.install("whisper-base.en");
    await socratesSpeechPacksApi.remove("whisper-base.en");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/\/api\/socrates\/speech\/packs\/whisper-base\.en\/install$/),
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/\/api\/socrates\/speech\/packs\/whisper-base\.en$/),
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("openrouter");
  });

  it("surfaces a backend install error without making a fallback request", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      ok: false,
      error: {
        code: "v2_speech_pack_download_failed",
        message: "The local Whisper pack could not be downloaded.",
        recoverable: true,
      },
    }, 502));
    vi.stubGlobal("fetch", fetchMock);

    await expect(socratesSpeechPacksApi.install("whisper-small.en")).rejects.toBeInstanceOf(SocratesSpeechPackApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
