import {
	buildVideoThumbnailFfmpegArgs,
	parseVideoMetaFromFfmpegOutput,
} from './whatsapp-video-probe';

const LANDSCAPE = `
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/in.mp4':
  Metadata:
    encoder         : Lavf60.16.100
  Duration: 00:00:46.02, start: 0.000000, bitrate: 361 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709), 1280x720 [SAR 1:1 DAR 16:9], 228 kb/s, 30 fps, 30 tbr, 15360 tbn
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 128 kb/s
`;

const ROTATED = `
  Duration: 00:01:30.50, start: 0.000000, bitrate: 2033 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p, 1920x1080 [SAR 1:1 DAR 16:9], 1899 kb/s, 30 fps
      Side data:
        displaymatrix: rotation of -90.00 degrees
`;

describe('parseVideoMetaFromFfmpegOutput', () => {
	it('reads duration and pixel size', () => {
		expect(parseVideoMetaFromFfmpegOutput(LANDSCAPE)).toEqual({
			seconds: 46.02,
			width: 1280,
			height: 720,
		});
	});

	it('reports a quarter-turned recording the way it is displayed', () => {
		expect(parseVideoMetaFromFfmpegOutput(ROTATED)).toEqual({
			seconds: 90.5,
			width: 1080,
			height: 1920,
		});
	});

	it('is not fooled by the codec tag or the audio line', () => {
		const meta = parseVideoMetaFromFfmpegOutput(LANDSCAPE);
		expect(meta.width).not.toBe(0);
		expect(`${meta.width}x${meta.height}`).toBe('1280x720');
	});

	it('returns zeroes rather than guesses when ffmpeg said nothing useful', () => {
		expect(parseVideoMetaFromFfmpegOutput('')).toEqual({ seconds: 0, width: 0, height: 0 });
		expect(parseVideoMetaFromFfmpegOutput('No such file or directory')).toEqual({
			seconds: 0,
			width: 0,
			height: 0,
		});
	});
});

describe('buildVideoThumbnailFfmpegArgs', () => {
	it('grabs one frame, boxed small enough to travel inside the message', () => {
		const args = buildVideoThumbnailFfmpegArgs('/in.mp4', '/out.jpg', 2);
		expect(args[args.indexOf('-ss') + 1]).toBe('2');
		expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
		expect(args[args.indexOf('-frames:v') + 1]).toBe('1');
		expect(args[args.indexOf('-vf') + 1]).toContain('320');
		expect(args[args.length - 1]).toBe('/out.jpg');
	});

	it('defaults to the opening frame and refuses a negative seek', () => {
		expect(buildVideoThumbnailFfmpegArgs('/in.mp4', '/out.jpg')[5]).toBe('0');
		const negative = buildVideoThumbnailFfmpegArgs('/in.mp4', '/out.jpg', -4);
		expect(negative[negative.indexOf('-ss') + 1]).toBe('0');
	});
});
