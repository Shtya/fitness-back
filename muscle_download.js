//  import fs from "fs";
// import path from "path";
// import { fileURLToPath } from "url";
// import { pipeline } from "stream/promises";

// const API =
//   "https://musclewiki.com/api-next/workout/originals/workouts?limit=50&equipment=&difficulty=&muscles=&goals=&ordering=default";

// const OUT_DIR = path.join(__dirname, "downloads");

// function ensureDir(p) {
//   fs.mkdirSync(p, { recursive: true });
// }

// function slugify(name) {
//   return String(name)
//     .toLowerCase()
//     .normalize("NFKD").replace(/[\u0300-\u036f]/g, "") // strip accents
//     .replace(/[^a-z0-9]+/g, "-")
//     .replace(/^-+|-+$/g, "")
//     .slice(0, 120);
// }

// function extFromContentType(ct) {
//   if (!ct) return null;
//   const m = ct.split(";")[0].trim().toLowerCase();
//   if (m === "image/jpeg" || m === "image/jpg") return ".jpg";
//   if (m === "image/png") return ".png";
//   if (m === "image/gif") return ".gif";
//   if (m === "image/webp") return ".webp";
//   if (m === "video/mp4") return ".mp4";
//   if (m === "video/webm") return ".webm";
//   if (m === "video/quicktime") return ".mov";
//   return null;
// }

// function extFromUrl(u) {
//   try {
//     const { pathname } = new URL(u);
//     const match = pathname.match(/\.(mp4|webm|mov|gif|jpe?g|png|webp)$/i);
//     return match ? `.${match[1].toLowerCase()}` : null;
//   } catch {
//     return null;
//   }
// }

// async function download(url, destBase) {
//   if (!url) return null;
//   try {
//     const res = await fetch(url);
//     if (!res.ok) {
//       console.warn(`⚠️  ${res.status} on ${url}`);
//       return null;
//     }
//     let ext = extFromUrl(url) || extFromContentType(res.headers.get("content-type")) || "";
//     const destPath = destBase + ext;
//     const ws = fs.createWriteStream(destPath);
//     await pipeline(res.body, ws);
//     return destPath;
//   } catch (e) {
//     console.warn(`⚠️  Failed ${url}: ${e.message}`);
//     return null;
//   }
// }

// function collectMediaFromExercise(ex) {
//   const images = [];
//   const videos = [];

//   // male_images / female_images can contain images and video URLs
//   const allImgRecs = [...(ex.male_images ?? []), ...(ex.female_images ?? [])];

//   for (const g of allImgRecs) {
//     // images
//     if (g.src_image) images.push(g.src_image);
//     else if (g.og_image) images.push(g.og_image);

//     // videos (prefer branded, then unbranded, then original)
//     if (g.branded_video) videos.push(g.branded_video);
//     else if (g.unbranded_video) videos.push(g.unbranded_video);
//     else if (g.original_video) videos.push(g.original_video);
//   }

//   // (Optional) long_form_content has YouTube – skipping actual download per your ask
//   // if you want to keep the link, uncomment:
//   // const yt = ex.long_form_content?.find(Boolean)?.youtube_link;
//   // if (yt) videos.push(yt); // note: will be a YouTube link

//   // dedupe while preserving order
//   const dedupe = (arr) => Array.from(new Set(arr.filter(Boolean)));
//   return {
//     images: dedupe(images),
//     videos: dedupe(videos).filter((u) => /^https?:/.test(u) && !/youtube\.com|youtu\.be/.test(u)), // skip YouTube
//   };
// }

// async function run() {
//   ensureDir(OUT_DIR);

//   console.log("Fetching first 50 workouts…");
//   const res = await fetch(API, { cache: "no-store" });
//   if (!res.ok) throw new Error(`API failed: ${res.status}`);
//   const data = await res.json();

//   // Unique exercises by id
//   const byId = new Map();
//   for (const w of data?.results ?? []) {
//     for (const entry of w?.exercises ?? []) {
//       const ex = entry?.exercise;
//       if (!ex?.id) continue;
//       if (!byId.has(ex.id)) byId.set(ex.id, ex);
//     }
//   }

//   const exercises = Array.from(byId.values()).sort((a, b) =>
//     a.name.localeCompare(b.name)
//   );
//   console.log(`Found ${exercises.length} unique exercises.`);

//   for (const ex of exercises) {
//     const slug = slugify(ex.name);
//     const { images, videos } = collectMediaFromExercise(ex);

//     console.log(`\n→ ${ex.name}  (imgs: ${images.length}, vids: ${videos.length})`);

//     // IMAGES
//     for (let i = 0; i < images.length; i++) {
//       const base = path.join(OUT_DIR, i === 0 ? `${slug}-img` : `${slug}-img-${i + 1}`);
//       const saved = await download(images[i], base);
//       if (saved) console.log("  •", path.basename(saved));
//     }

//     // VIDEOS
//     for (let i = 0; i < videos.length; i++) {
//       const base = path.join(OUT_DIR, i === 0 ? `${slug}-vid` : `${slug}-vid-${i + 1}`);
//       const saved = await download(videos[i], base);
//       if (saved) console.log("  •", path.basename(saved));
//     }
//   }

//   console.log("\n✅ Done. Files are in ./downloads/");
// }

// run().catch((e) => {
//   console.error(e);
//   process.exit(1);
// });




// Node 18+ (built-in fetch)
// Usage:
//   1) npm i sharp
//   2) node download_assets.js

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { pipeline } from "stream/promises";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

 const downloadAssets = [
	{ id: 1, images : ['https://media.musclewiki.com/media/uploads/og-male-Band-band-bayesian-curl-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Band-band-bayesian-curl-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Band-band-bayesian-curl-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Band-band-bayesian-curl-side.mp4'] },
	{ id: 2, images : ['https://media.musclewiki.com/media/uploads/og-male-Band-band-calf-raise-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Band-band-calf-raise-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Band-band-calf-raise-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Band-band-calf-raise-front.mp4'] },
	{ id: 3, images : ['https://media.musclewiki.com/media/uploads/og-male-Band-band-crunch-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Band-band-crunch-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Band-band-crunch-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Band-band-crunch-front.mp4'] },
	{ id: 4, images : ['https://media.musclewiki.com/media/uploads/og-male-Band-band-glute-kickback-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Band-band-glute-kickback-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Band-band-glute-kickback-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Band-band-glute-kickback-side.mp4'] },
	{ id: 5, images : ['https://media.musclewiki.com/media/uploads/male-band-good-morning-front_sGY7lws.gif', 'https://media.musclewiki.com/media/uploads/male-band-good-morning-side_xIpzCY0.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-band-good-morning-front_8qJRfbm.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-band-good-morning-side_pGmFQtq.mp4'] },
	{ id: 6, images : ['https://media.musclewiki.com/media/uploads/male-band-kneeling-single-arm-pulldown-front.gif', 'https://media.musclewiki.com/media/uploads/male-band-kneeling-single-arm-pulldown-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-band-kneeling-single-arm-pulldown-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-band-kneeling-single-arm-pulldown-side.mp4'] },
	{ id: 7, images : ['https://media.musclewiki.com/media/uploads/og-male-Band-band-leg-press-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Band-band-leg-press-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Band-band-leg-press-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Band-band-leg-press-front.mp4'] },
	{ id: 8, images : ['https://media.musclewiki.com/media/uploads/og-male-Band-band-pull-apart-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Band-band-pull-apart-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Band-band-pull-apart-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Band-band-pull-apart-side.mp4'] },
	{ id: 9, images : ['https://media.musclewiki.com/media/uploads/og-male-Band-band-pullover-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Band-band-pullover-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Band-band-pullover-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Band-band-pullover-front.mp4'] },
	{ id: 10, images : ['https://media.musclewiki.com/media/uploads/male-band-pushdown-front.gif', 'https://media.musclewiki.com/media/uploads/male-band-pushdown-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-band-pushdown-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-band-pushdown-side.mp4'] },
	{ id: 11, images : ['https://media.musclewiki.com/media/uploads/male-band-pushup-front.gif', 'https://media.musclewiki.com/media/uploads/male-band-pushup-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-band-pushup-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-band-pushup-side.mp4'] },
	{ id: 12, images : ['https://media.musclewiki.com/media/uploads/og-male-band-rapunzel-pushdown-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-band-rapunzel-pushdown-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-band-rapunzel-pushdown-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-band-rapunzel-pushdown-side.mp4'] },
	{ id: 13, images : ['https://media.musclewiki.com/media/uploads/og-male-Band-band-romanian-deadlift-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Band-band-romanian-deadlift-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Band-band-romanian-deadlift-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Band-band-romanian-deadlift-side.mp4'] },
	{ id: 14, images : ['https://media.musclewiki.com/media/uploads/og-male-Band-band-row-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Band-band-row-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Band-band-row-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Band-band-row-front.mp4'] },
	{ id: 15, images : ['https://media.musclewiki.com/media/uploads/male-band-single-arm-overhead-press-front.gif', 'https://media.musclewiki.com/media/uploads/male-band-single-arm-overhead-press-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-band-single-arm-overhead-press-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-band-single-arm-overhead-press-side.mp4'] },
	{ id: 16, images : ['https://media.musclewiki.com/media/uploads/og-male-Band-band-skullcrusher-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Band-band-skullcrusher-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Band-band-skullcrusher-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Band-band-skullcrusher-side.mp4'] },
	{ id: 17, images : ['https://media.musclewiki.com/media/uploads/og-male-Band-band-spanish-squat-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Band-band-spanish-squat-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Band-band-spanish-squat-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Band-band-spanish-squat-side.mp4'] },
	{ id: 18, images : ['https://media.musclewiki.com/media/uploads/og-male-Band-band-squat-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Band-band-squat-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Band-band-squat-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Band-band-squat-side.mp4'] },
	{ id: 19, images : ['https://media.musclewiki.com/media/uploads/og-male-Band-band-wood-chopper-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Band-band-wood-chopper-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Band-band-wood-chopper-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Band-band-wood-chopper-side.mp4'] },
	{ id: 20, images : ['https://media.musclewiki.com/media/uploads/male-barbell-bench-press-front_C2G7O8r.gif', 'https://media.musclewiki.com/media/uploads/male-barbell-bench-press-side_giVNk12.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-barbell-bench-press-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-barbell-bench-press-side_KciuhbB.mp4'] },
	{ id: 21, images : ['https://media.musclewiki.com/media/uploads/male-barbell-bent-over-row-front.gif', 'https://media.musclewiki.com/media/uploads/male-barbell-bent-over-row-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-barbell-bent-over-row-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-barbell-bent-over-row-side.mp4'] },
	{ id: 22, images : ['https://media.musclewiki.com/media/uploads/male-barbell-calf-jump-front.gif', 'https://media.musclewiki.com/media/uploads/male-barbell-calf-jump-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-barbell-calf-jump-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-barbell-calf-jump-side.mp4'] },
	{ id: 23, images : ['https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-curl-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-curl-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-curl-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-curl-side.mp4'] },
	{ id: 24, images : ['https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-deadlift-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-deadlift-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-deadlift-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-deadlift-side.mp4'] },
	{ id: 25, images : ['https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-high-bar-squat-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-high-bar-squat-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-high-bar-squat-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-high-bar-squat-front.mp4'] },
	{ id: 26, images : ['https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-hip-thrust-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-hip-thrust-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-hip-thrust-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-hip-thrust-side.mp4'] },
	{ id: 27, images : ['https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-incline-bench-press-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-incline-bench-press-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-incline-bench-press-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-incline-bench-press-side.mp4'] },
	{ id: 28, images : ['https://media.musclewiki.com/media/uploads/male-barbell-landmine-row-front.gif', 'https://media.musclewiki.com/media/uploads/male-barbell-landmine-row-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-barbell-landmine-row-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-barbell-landmine-row-side.mp4'] },
	{ id: 29, images : ['https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-low-bar-good-morning-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-low-bar-good-morning-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-low-bar-good-morning-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-low-bar-good-morning-front.mp4'] },
	{ id: 30, images : ['https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-overhead-press-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-overhead-press-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-overhead-press-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-overhead-press-side.mp4'] },
	{ id: 31, images : ['https://media.musclewiki.com/media/uploads/male-barbell-pause-squat-front.gif', 'https://media.musclewiki.com/media/uploads/male-barbell-pause-squat-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-barbell-pause-box-squat-front_GEhqEjs.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-barbell-pause-box-squat-side_2PFhPFu.mp4'] },
	{ id: 32, images : ['https://media.musclewiki.com/media/uploads/male-barbell-reverse-lunge-front.gif', 'https://media.musclewiki.com/media/uploads/male-barbell-reverse-lunge-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-barbell-reverse-lunge-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-barbell-reverse-lunge-side.mp4'] },
	{ id: 33, images : ['https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-romanian-deadlift-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-romanian-deadlift-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-romanian-deadlift-side_dnNh5UH.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-romanian-deadlift-front.mp4'] },
	{ id: 34, images : ['https://media.musclewiki.com/media/uploads/male-barbell-seated-calf-raise-front.gif', 'https://media.musclewiki.com/media/uploads/male-barbell-seated-calf-raise-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-barbell-seated-calf-raise-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-barbell-seated-calf-raise-side.mp4'] },
	{ id: 35, images : ['https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-situp-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-situp-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-situp-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-situp-front.mp4'] },
	{ id: 36, images : ['https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-skullcrusher-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-skullcrusher-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-skullcrusher-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-skullcrusher-side.mp4'] },
	{ id: 37, images : ['https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-squat-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-squat-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-squat-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-squat-front.mp4'] },
	{ id: 38, images : ['https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-upright-row-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-upright-row-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-upright-row-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-upright-row-front.mp4'] },
	{ id: 39, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-bench-dips-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-bench-dips-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-bench-dips-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-bench-dips-side.mp4'] },
	{ id: 40, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-bodyweight-knee-push-ups-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-bodyweight-knee-push-ups-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-bodyweight-knee-push-ups-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-bodyweight-knee-push-ups-side.mp4'] },
	{ id: 41, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-bodyweight-reverse-lunge-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-bodyweight-reverse-lunge-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-bodyweight-reverse-lunge-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-bodyweight-reverse-lunge-front.mp4'] },
	{ id: 42, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-bodyweight-squat-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-bodyweight-squat-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-bodyweight-squat-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-bodyweight-squat-side.mp4'] },
	{ id: 43, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-dips-front_NNVDdsi.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-dips-side_LGv4umu.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-dips-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-dips-side.mp4'] },
	{ id: 44, images : ['https://media.musclewiki.com/media/uploads/og-male-bodyweight-burpee-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-bodyweight-burpee-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-burpee-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-burpee-side.mp4'] },
	{ id: 45, images : ['https://media.musclewiki.com/media/uploads/og-male-Cables-cable-30-degree-shrug-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Cables-cable-30-degree-shrug-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-30-degree-shrug-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-30-degree-shrug-side.mp4'] },
	{ id: 46, images : ['https://media.musclewiki.com/media/uploads/og-male-Cables-cable-romanian-deadlift-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Cables-cable-romanian-deadlift-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-romanian-deadlift-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-romanian-deadlift-front.mp4'] },
	{ id: 47, images : ['https://media.musclewiki.com/media/uploads/og-male-Cables-cable-pullover-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Cables-cable-pullover-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-pullover-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-pullover-side.mp4'] },
	{ id: 48, images : ['https://media.musclewiki.com/media/uploads/male-cable-chestpress-front.gif', 'https://media.musclewiki.com/media/uploads/male-cable-chestpress-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-cable-chestpress-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-cable-chestpress-side.mp4'] },
	{ id: 49, images : ['https://media.musclewiki.com/media/uploads/og-male-Cables-cable-cross-pushdown-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Cables-cable-cross-pushdown-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-cross-pushdown-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-cross-pushdown-side.mp4'] },
	{ id: 50, images : ['https://media.musclewiki.com/media/uploads/og-male-Cables-cable-goblet-squat-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Cables-cable-goblet-squat-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-goblet-squat-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-goblet-squat-side.mp4'] },
	{ id: 51, images : ['https://media.musclewiki.com/media/uploads/male-cable-hamstring-curl-side.gif', 'https://media.musclewiki.com/media/uploads/male-cable-hamstring-curl-front.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-cable-hamstring-curl-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-cable-hamstring-curl-front.mp4'] },
	{ id: 52, images : ['https://media.musclewiki.com/media/uploads/og-male-Cables-cable-rear-delt-fly-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Cables-cable-rear-delt-fly-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-rear-delt-fly-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-rear-delt-fly-side.mp4'] },
	{ id: 53, images : ['https://media.musclewiki.com/media/uploads/og-male-Cables-cable-lat-prayer-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Cables-cable-lat-prayer-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-lat-prayer-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-lat-prayer-side.mp4'] },
	{ id: 54, images : ['https://media.musclewiki.com/media/uploads/og-male-Cables-cable-pallof-press-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Cables-cable-pallof-press-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-pallof-press-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-pallof-press-side.mp4'] },
	{ id: 55, images : ['https://media.musclewiki.com/media/uploads/male-cable-pec-fly-front.gif', 'https://media.musclewiki.com/media/uploads/male-cable-pec-fly-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-cable-pec-fly-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-cable-pec-fly-side.mp4'] },
	{ id: 56, images : ['https://media.musclewiki.com/media/uploads/og-male-Cables-cable-push-down-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Cables-cable-push-down-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-push-down-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-push-down-front.mp4'] },
	{ id: 57, images : ['https://media.musclewiki.com/media/uploads/og-male-Cables-cable-skullcrusher-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Cables-cable-skullcrusher-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-skullcrusher-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-skullcrusher-side.mp4'] },
	{ id: 58, images : ['https://media.musclewiki.com/media/uploads/og-male-Cables-cable-hip-abduction-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Cables-cable-hip-abduction-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-hip-abduction-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-hip-abduction-front.mp4'] },
	{ id: 59, images : ['https://media.musclewiki.com/media/uploads/og-male-Cables-cable-glute-kickback-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Cables-cable-glute-kickback-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-glute-kickback-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-glute-kickback-front.mp4'] },
	{ id: 60, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-calf-raises-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-calf-raises-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-calf-raises-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-calf-raises-side.mp4'] },
	{ id: 61, images : ['https://media.musclewiki.com/media/uploads/male-bodyweight-chinup-front.gif', 'https://media.musclewiki.com/media/uploads/male-bodyweight-chinup-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-chinup-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-chinup-side.mp4'] },
	{ id: 62, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-decline-push-up-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-decline-push-up-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-decline-push-up-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-decline-push-up-side.mp4'] },
	{ id: 63, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-arnold-press-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-arnold-press-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-arnold-press-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-arnold-press-side.mp4'] },
	{ id: 64, images : ['https://media.musclewiki.com/media/uploads/male-dumbbell-bayesian-lateral-raise-front.gif', 'https://media.musclewiki.com/media/uploads/male-dumbbell-bayesian-lateral-raise-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-bayesian-lateral-raise-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-bayesian-lateral-raise-side.mp4'] },
	{ id: 65, images : ['https://media.musclewiki.com/media/uploads/male-dumbbell-bench-press-front_6bhb6AR.gif', 'https://media.musclewiki.com/media/uploads/male-dumbbell-bench-press-side_MnLKkhK.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-bench-press-front_y8zKZJl.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-bench-press-side_rqe1iTe.mp4'] },
	{ id: 66, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-bulgarian-split-squat-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-bulgarian-split-squat-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-bulgarian-split-squat-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-bulgarian-split-squat-side.mp4'] },
	{ id: 67, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-calf-raise-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-calf-raise-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-calf-raise-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-calf-raise-side.mp4'] },
	{ id: 68, images : ['https://media.musclewiki.com/media/uploads/male-dumbbell-chest-fly-front.gif', 'https://media.musclewiki.com/media/uploads/male-dumbbell-chest-fly-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-chest-fly-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-chest-fly-side.mp4'] },
	{ id: 69, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-curl-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-curl-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-curl-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-curl-side.mp4'] },
	{ id: 70, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-elbow-side-plank-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-elbow-side-plank-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-elbow-side-plank-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-elbow-side-plank-front.mp4'] },
	{ id: 71, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-forward-lunge-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-forward-lunge-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-forward-lunge-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-forward-lunge-front.mp4'] },
	{ id: 72, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-goblet-good-morning-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-goblet-good-morning-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-goblet-good-morning-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-goblet-good-morning-side.mp4'] },
	{ id: 73, images : ['https://media.musclewiki.com/media/uploads/og-male-dumbbell-goblet-pulse-squat-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-dumbbell-goblet-pulse-squat-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-goblet-pulse-squat-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-goblet-pulse-squat-side.mp4'] },
	{ id: 74, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-goblet-reverse-lunge-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-goblet-reverse-lunge-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-goblet-reverse-lunge-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-goblet-reverse-lunge-front.mp4'] },
	{ id: 75, images : ['https://media.musclewiki.com/media/uploads/male-dumbbell-goblet-squat-front.gif', 'https://media.musclewiki.com/media/uploads/male-dumbbell-goblet-squat-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-goblet-squat-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-goblet-squat-side.mp4'] },
	{ id: 76, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-hammer-curl-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-hammer-curl-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-hammer-curl-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-hammer-curl-side.mp4'] },
	{ id: 77, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-heels-up-goblet-squat-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-heels-up-goblet-squat-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-heels-up-goblet-squat-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-heels-up-goblet-squat-side.mp4'] },
	{ id: 78, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-hip-thrust-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-hip-thrust-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-hip-thrust-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-hip-thrust-front.mp4'] },
	{ id: 79, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-lateral-raise-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-lateral-raise-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-lateral-raise-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-lateral-raise-side.mp4'] },
	{ id: 80, images : ['https://media.musclewiki.com/media/uploads/male-dumbbell-laying-reverse-fly-front.gif', 'https://media.musclewiki.com/media/uploads/male-dumbbell-laying-reverse-fly-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-laying-reverse-fly-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-laying-reverse-fly-side.mp4'] },
	{ id: 81, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-neutral-overhead-press-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-neutral-overhead-press-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-neutral-overhead-press-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-neutral-overhead-press-front.mp4'] },
	{ id: 82, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-overhead-press-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-overhead-press-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-overhead-press-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-overhead-press-front.mp4'] },
	{ id: 83, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-overhead-tricep-extension-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-overhead-tricep-extension-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-overhead-tricep-extension-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-overhead-tricep-extension-front.mp4'] },
	{ id: 84, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-reverse-lunge-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-reverse-lunge-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-reverse-lunge-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-reverse-lunge-front.mp4'] },
	{ id: 85, images : ['https://media.musclewiki.com/media/uploads/male-dumbbell-rolling-tricep-extension-front.gif', 'https://media.musclewiki.com/media/uploads/male-dumbbell-rolling-tricep-extension-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-rolling-tricep-extension-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-rolling-tricep-extension-side.mp4'] },
	{ id: 86, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-romanian-deadlift-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-romanian-deadlift-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-romanian-deadlift-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-romanian-deadlift-side.mp4'] },
	{ id: 87, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-row-bilateral-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-row-bilateral-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-row-bilateral-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-row-bilateral-side.mp4'] },
	{ id: 88, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-seated-calf-raise-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-seated-calf-raise-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-seated-calf-raise-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-seated-calf-raise-front.mp4'] },
	{ id: 89, images : ['https://media.musclewiki.com/media/uploads/male-dumbbell-seated-overhead-press-front.gif', 'https://media.musclewiki.com/media/uploads/male-dumbbell-seated-overhead-press-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-seated-overhead-press-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-seated-overhead-press-side.mp4'] },
	{ id: 90, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-single-arm-row-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-single-arm-row-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-single-arm-row-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-single-arm-row-side.mp4'] },
	{ id: 91, images : ['https://media.musclewiki.com/media/uploads/og-male-dumbbell-single-leg-hip-thrust-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-dumbbell-single-leg-hip-thrust-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-single-leg-hip-thrust-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-single-leg-hip-thrust-side.mp4'] },
	{ id: 92, images : ['https://media.musclewiki.com/media/uploads/male-dumbbell-skullcrusher-front_cIzuH3x.gif', 'https://media.musclewiki.com/media/uploads/male-dumbbell-skullcrusher-side_SE7Q8au.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-skullcrusher-front_hgKANkM.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-skullcrusher-side_bgn7Uzz.mp4'] },
	{ id: 93, images : ['https://media.musclewiki.com/media/uploads/og-male-dumbbell-standing-hip-abduction-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-dumbbell-standing-hip-abduction-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-standing-hip-abduction-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-standing-hip-abduction-side.mp4'] },
	{ id: 94, images : ['https://media.musclewiki.com/media/uploads/og-male-dumbbell-twisting-curl-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-dumbbell-twisting-curl-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-twisting-curl-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-twisting-curl-side.mp4'] },
	{ id: 95, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-wood-chopper-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-wood-chopper-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-wood-chopper-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-wood-chopper-side.mp4'] },
	{ id: 96, images : ['https://media.musclewiki.com/media/nofile.gif', 'https://media.musclewiki.com/media/nofile.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-elbow-side-plank-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-elbow-side-plank-side.mp4'] },
	{ id: 97, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-elevated-pike-press-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-elevated-pike-press-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-elevated-pike-press-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-elevated-pike-press-side.mp4'] },
	{ id: 98, images : ['https://media.musclewiki.com/media/uploads/male-bodyweight-forearm-plank-front_9t1UHBy.gif', 'https://media.musclewiki.com/media/uploads/male-bodyweight-forearm-plank-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-forearm-plank-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-forearm-plank-side.mp4'] },
	{ id: 99, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-forward-lunges-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-forward-lunges-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-forward-lunges-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-forward-lunges-side.mp4'] },
	{ id: 100, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-glute-bridge-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-glute-bridge-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-glute-bridge-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-glute-bridge-front.mp4'] },
	{ id: 101, images : ['https://media.musclewiki.com/media/uploads/og-male-machine-glute-ham-raise-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-machine-glute-ham-raise-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-machine-glute-ham-raise-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-machine-glute-ham-raise-side.mp4'] },
	{ id: 102, images : ['https://media.musclewiki.com/media/nofile.gif', 'https://media.musclewiki.com/media/nofile.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-hand-plank-side_GnZ2NZh.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-hand-plank-front_ZnMlFBF.mp4'] },
	{ id: 103, images : ['https://media.musclewiki.com/media/uploads/male-bodyweight-hanging-knee-raises-front.gif', 'https://media.musclewiki.com/media/uploads/male-bodyweight-hanging-knee-raises-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-hanging-knee-raises-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-hanging-knee-raises-side.mp4'] },
	{ id: 104, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-hollow-hold-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-hollow-hold-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-hollow-hold-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-hollow-hold-side.mp4'] },
	{ id: 105, images : ['https://media.musclewiki.com/media/uploads/og-male-Kettlebells-kettlebell-concentration-curl-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Kettlebells-kettlebell-concentration-curl-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Kettlebells-kettlebell-concentration-curl-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Kettlebells-kettlebell-concentration-curl-side.mp4'] },
	{ id: 106, images : ['https://media.musclewiki.com/media/uploads/male-kettlebell-deadlift-front.gif', 'https://media.musclewiki.com/media/uploads/male-kettlebell-deadlift-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Kettlebells-kettlebell-romanian-deadlift-single-front_VRxcefY.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Kettlebells-kettlebell-romanian-deadlift-single-side_cdM5Jjj.mp4'] },
	{ id: 107, images : ['https://media.musclewiki.com/media/uploads/og-male-Kettlebells-kettlebell-russian-twist-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Kettlebells-kettlebell-russian-twist-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Kettlebells-kettlebell-russian-twist-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Kettlebells-kettlebell-russian-twist-side.mp4'] },
	{ id: 108, images : ['https://media.musclewiki.com/media/uploads/og-male-Kettlebells-kettlebell-single-arm-reverse-lunge-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Kettlebells-kettlebell-single-arm-reverse-lunge-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Kettlebells-kettlebell-single-arm-reverse-lunge-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Kettlebells-kettlebell-single-arm-reverse-lunge-side.mp4'] },
	{ id: 109, images : ['https://media.musclewiki.com/media/uploads/og-male-Kettlebells-kettlebell-single-arm-row-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Kettlebells-kettlebell-single-arm-row-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Kettlebells-kettlebell-single-arm-row-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Kettlebells-kettlebell-single-arm-row-front.mp4'] },
	{ id: 110, images : ['https://media.musclewiki.com/media/uploads/og-male-Kettlebells-kettlebell-situp-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Kettlebells-kettlebell-situp-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Kettlebells-kettlebell-situp-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Kettlebells-kettlebell-situp-side.mp4'] },
	{ id: 111, images : ['https://media.musclewiki.com/media/uploads/og-male-Kettlebells-kettlebell-skull-crusher-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Kettlebells-kettlebell-skull-crusher-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Kettlebells-kettlebell-skull-crusher-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Kettlebells-kettlebell-skull-crusher-front.mp4'] },
	{ id: 112, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-kickbacks-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-kickbacks-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-kickbacks-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-kickbacks-side.mp4'] },
	{ id: 113, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-lateral-lunge-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-lateral-lunge-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-lateral-lunge-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-lateral-lunge-side.mp4'] },
	{ id: 114, images : ['https://media.musclewiki.com/media/uploads/male-cable-push-downs-front.gif', 'https://media.musclewiki.com/media/uploads/male-cable-push-downs-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-cable-push-downs-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-cable-push-downs-side.mp4'] },
	{ id: 115, images : ['https://media.musclewiki.com/media/uploads/male-machine-hamstring-curl-front.gif', 'https://media.musclewiki.com/media/uploads/male-machine-hamstring-curl-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-machine-hamstring-curl-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-machine-hamstring-curl-side.mp4'] },
	{ id: 116, images : ['https://media.musclewiki.com/media/uploads/male-machine-leg-extension-front.gif', 'https://media.musclewiki.com/media/uploads/male-machine-leg-extension-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-machine-leg-extension-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-machine-leg-extension-side.mp4'] },
	{ id: 117, images : ['https://media.musclewiki.com/media/uploads/male-machine-pulldown-front.gif', 'https://media.musclewiki.com/media/uploads/male-machine-pulldown-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-machine-pulldown-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-machine-pulldown-side.mp4'] },
	{ id: 118, images : ['https://media.musclewiki.com/media/uploads/male-machine-seated-cable-row-front.gif', 'https://media.musclewiki.com/media/uploads/male-machine-seated-cable-row-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-machine-seated-cable-row-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-machine-seated-cable-row-side.mp4'] },
	{ id: 119, images : ['https://media.musclewiki.com/media/uploads/male-machine-standing-calf-raises-front.gif', 'https://media.musclewiki.com/media/uploads/male-machine-standing-calf-raises-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-machine-standing-calf-raises-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-machine-standing-calf-raises-side.mp4'] },
	{ id: 120, images : ['https://media.musclewiki.com/media/uploads/og-male-bodyweight-mountain-climber-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-bodyweight-mountain-climber-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-mountain-climber-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-mountain-climber-side.mp4'] },
	{ id: 121, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-nordic-hamstring-curl-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-nordic-hamstring-curl-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-nordic-hamstring-curl-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-nordic-hamstring-curl-side.mp4'] },
	{ id: 122, images : ['https://media.musclewiki.com/media/uploads/og-male-plate-full-lateral-raise-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-plate-full-lateral-raise-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-plate-full-lateral-raise-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-plate-full-lateral-raise-side.mp4'] },
	{ id: 123, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-push-up-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-push-up-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-push-up-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-push-up-side.mp4'] },
	{ id: 124, images : ['https://media.musclewiki.com/media/nofile.gif', 'https://media.musclewiki.com/media/nofile.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-side-plank-reach-through-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-side-plank-reach-through-side.mp4'] },
	{ id: 125, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-supermans-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-supermans-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-supermans-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-supermans-front.mp4'] },
	{ id: 126, images : ['https://media.musclewiki.com/media/uploads/og-male-plate-weighted-forearm-plank-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-plate-weighted-forearm-plank-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-plate-weighted-forearm-plank-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-plate-weighted-forearm-plank-side.mp4'] },
	{ id: 127, images : ['https://media.musclewiki.com/media/uploads/og-male-Band-band-pull-apart-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Band-band-pull-apart-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Band-band-pull-apart-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Band-band-pull-apart-side.mp4'] },
	{ id: 128, images : ['https://media.musclewiki.com/media/uploads/male-barbell-bench-press-front_C2G7O8r.gif', 'https://media.musclewiki.com/media/uploads/male-barbell-bench-press-side_giVNk12.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-barbell-bench-press-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-barbell-bench-press-side_KciuhbB.mp4'] },
	{ id: 129, images : ['https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-close-grip-bench-press-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-close-grip-bench-press-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-close-grip-bench-press-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-close-grip-bench-press-front.mp4'] },
	{ id: 130, images : ['https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-curl-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-curl-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-curl-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-curl-side.mp4'] },
	{ id: 131, images : ['https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-deadlift-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-deadlift-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-deadlift-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-deadlift-side.mp4'] },
	{ id: 132, images : ['https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-front-squat-bodybuilding-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-front-squat-bodybuilding-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-front-squat-bodybuilding-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-front-squat-bodybuilding-front.mp4'] },
	{ id: 133, images : ['https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-high-bar-squat-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-high-bar-squat-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-high-bar-squat-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-high-bar-squat-front.mp4'] },
	{ id: 134, images : ['https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-hip-thrust-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-hip-thrust-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-hip-thrust-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-hip-thrust-side.mp4'] },
	{ id: 135, images : ['https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-low-bar-good-morning-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-low-bar-good-morning-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-low-bar-good-morning-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-low-bar-good-morning-front.mp4'] },
	{ id: 136, images : ['https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-overhead-press-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-overhead-press-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-overhead-press-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-overhead-press-side.mp4'] },
	{ id: 137, images : ['https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-romanian-deadlift-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-romanian-deadlift-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-romanian-deadlift-side_dnNh5UH.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-romanian-deadlift-front.mp4'] },
	{ id: 138, images : ['https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-skullcrusher-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-skullcrusher-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-skullcrusher-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-skullcrusher-side.mp4'] },
	{ id: 139, images : ['https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-squat-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-squat-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-squat-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-squat-front.mp4'] },
	{ id: 140, images : ['https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-staggered-deadlift-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-staggered-deadlift-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-staggered-deadlift-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-staggered-deadlift-front.mp4'] },
	{ id: 141, images : ['https://media.musclewiki.com/media/uploads/male-barbell-stiff-leg-deadlift-front.gif', 'https://media.musclewiki.com/media/uploads/male-barbell-stiff-leg-deadlift-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-barbell-stiff-leg-deadlift-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-barbell-stiff-leg-deadlift-side.mp4'] },
	{ id: 142, images : ['https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-upright-row-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Barbell-barbell-upright-row-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-upright-row-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Barbell-barbell-upright-row-front.mp4'] },
	{ id: 143, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-bicycle-crunch-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-bicycle-crunch-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-bicycle-crunch-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-bicycle-crunch-front.mp4'] },
	{ id: 144, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-bodyweight-assisted-chin-up-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-bodyweight-assisted-chin-up-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-bodyweight-assisted-chin-up-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-bodyweight-assisted-chin-up-side.mp4'] },
	{ id: 145, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-bodyweight-box-assisted-dips-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-bodyweight-box-assisted-dips-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-bodyweight-box-assisted-dips-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-bodyweight-box-assisted-dips-front.mp4'] },
	{ id: 146, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-bodyweight-diamond-knee-push-ups-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-bodyweight-diamond-knee-push-ups-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-bodyweight-diamond-knee-push-ups-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-bodyweight-diamond-knee-push-ups-side.mp4'] },
	{ id: 147, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-bodyweight-knee-push-ups-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-bodyweight-knee-push-ups-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-bodyweight-knee-push-ups-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-bodyweight-knee-push-ups-side.mp4'] },
	{ id: 148, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-bodyweight-reverse-lunge-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-bodyweight-reverse-lunge-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-bodyweight-reverse-lunge-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-bodyweight-reverse-lunge-front.mp4'] },
	{ id: 149, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-bodyweight-squat-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-bodyweight-squat-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-bodyweight-squat-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-bodyweight-squat-side.mp4'] },
	{ id: 150, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-bodyweight-standing-inverted-row-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-bodyweight-standing-inverted-row-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-bodyweight-standing-inverted-row-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-bodyweight-standing-inverted-row-front.mp4'] },
	{ id: 151, images : ['https://media.musclewiki.com/media/uploads/og-male-bodyweight-burpee-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-bodyweight-burpee-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-burpee-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-burpee-side.mp4'] },
	{ id: 152, images : ['https://media.musclewiki.com/media/uploads/og-male-Cables-cable-30-degree-shrug-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Cables-cable-30-degree-shrug-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-30-degree-shrug-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-30-degree-shrug-side.mp4'] },
	{ id: 153, images : ['https://media.musclewiki.com/media/uploads/og-male-Cables-cable-bar-curl-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Cables-cable-bar-curl-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-bar-curl-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-bar-curl-side.mp4'] },
	{ id: 154, images : ['https://media.musclewiki.com/media/uploads/og-male-Cables-cable-bar-pushdown-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Cables-cable-bar-pushdown-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-bar-pushdown-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-bar-pushdown-side.mp4'] },
	{ id: 155, images : ['https://media.musclewiki.com/media/uploads/og-male-Cables-cable-bar-reverse-grip-pushdown-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Cables-cable-bar-reverse-grip-pushdown-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-bar-reverse-grip-pushdown-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-bar-reverse-grip-pushdown-side.mp4'] },
	{ id: 156, images : ['https://media.musclewiki.com/media/uploads/og-male-Cables-cable-bilateral-bayesian-curl-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Cables-cable-bilateral-bayesian-curl-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-bilateral-bayesian-curl-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-bilateral-bayesian-curl-front.mp4'] },
	{ id: 157, images : ['https://media.musclewiki.com/media/uploads/og-male-Cables-cable-high-reverse-fly-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Cables-cable-high-reverse-fly-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-high-reverse-fly-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-high-reverse-fly-front.mp4'] },
	{ id: 158, images : ['https://media.musclewiki.com/media/uploads/og-male-Cables-cable-incline-chest-fly-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Cables-cable-incline-chest-fly-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-incline-chest-fly-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-incline-chest-fly-front.mp4'] },
	{ id: 159, images : ['https://media.musclewiki.com/media/uploads/og-male-Cables-cable-lateral-raise-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Cables-cable-lateral-raise-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-lateral-raise-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-lateral-raise-side.mp4'] },
	{ id: 160, images : ['https://media.musclewiki.com/media/uploads/male-cable-pec-fly-front.gif', 'https://media.musclewiki.com/media/uploads/male-cable-pec-fly-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-cable-pec-fly-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-cable-pec-fly-side.mp4'] },
	{ id: 161, images : ['https://media.musclewiki.com/media/uploads/og-male-Machine-machine-face-pulls-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Machine-machine-face-pulls-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Machine-machine-face-pulls-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Machine-machine-face-pulls-side.mp4'] },
	{ id: 162, images : ['https://media.musclewiki.com/media/uploads/og-male-Cables-cable-rope-kneeling-oblique-crunch-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Cables-cable-rope-kneeling-oblique-crunch-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-rope-kneeling-oblique-crunch-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-rope-kneeling-oblique-crunch-side.mp4'] },
	{ id: 163, images : ['https://media.musclewiki.com/media/uploads/og-male-Cables-cable-overhead-tricep-extension-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Cables-cable-overhead-tricep-extension-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-overhead-tricep-extension-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-overhead-tricep-extension-side.mp4'] },
	{ id: 164, images : ['https://media.musclewiki.com/media/uploads/og-male-Cables-cable-push-down-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Cables-cable-push-down-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-push-down-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-push-down-front.mp4'] },
	{ id: 165, images : ['https://media.musclewiki.com/media/uploads/og-male-Cables-cable-kneeling-crunch-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Cables-cable-kneeling-crunch-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-kneeling-crunch-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-kneeling-crunch-side.mp4'] },
	{ id: 166, images : ['https://media.musclewiki.com/media/uploads/og-male-Cables-cable-single-arm-skullcrusher-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Cables-cable-single-arm-skullcrusher-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-single-arm-skullcrusher-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Cables-cable-single-arm-skullcrusher-side.mp4'] },
	{ id: 167, images : ['https://media.musclewiki.com/media/uploads/male-cable-woodchopper-front.gif', 'https://media.musclewiki.com/media/uploads/male-cable-woodchopper-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-cable-woodchopper-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-cable-woodchopper-side.mp4'] },
	{ id: 168, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-calf-raises-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-calf-raises-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-calf-raises-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-calf-raises-side.mp4'] },
	{ id: 169, images : ['https://media.musclewiki.com/media/uploads/og-male-Cardio-cardio-in-and-out-forward-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Cardio-cardio-in-and-out-forward-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Cardio-cardio-in-and-out-forward-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Cardio-cardio-in-and-out-forward-side.mp4'] },
	{ id: 170, images : ['https://media.musclewiki.com/media/uploads/og-male-Cardio-cardio-skater-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Cardio-cardio-skater-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Cardio-cardio-skater-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Cardio-cardio-skater-side.mp4'] },
	{ id: 171, images : ['https://media.musclewiki.com/media/uploads/male-bodyweight-chinup-front.gif', 'https://media.musclewiki.com/media/uploads/male-bodyweight-chinup-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-chinup-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-chinup-side.mp4'] },
	{ id: 172, images : ['https://media.musclewiki.com/media/uploads/male-bodyweight-crunch-front.gif', 'https://media.musclewiki.com/media/uploads/male-bodyweight-crunch-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-crunch-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-crunch-side.mp4'] },
	{ id: 173, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-arnold-press-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-arnold-press-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-arnold-press-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-arnold-press-side.mp4'] },
	{ id: 174, images : ['https://media.musclewiki.com/media/uploads/male-dumbbell-bayesian-lateral-raise-front.gif', 'https://media.musclewiki.com/media/uploads/male-dumbbell-bayesian-lateral-raise-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-bayesian-lateral-raise-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-bayesian-lateral-raise-side.mp4'] },
	{ id: 175, images : ['https://media.musclewiki.com/media/uploads/male-dumbbell-bench-press-front_6bhb6AR.gif', 'https://media.musclewiki.com/media/uploads/male-dumbbell-bench-press-side_MnLKkhK.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-bench-press-front_y8zKZJl.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-bench-press-side_rqe1iTe.mp4'] },
	{ id: 176, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-bulgarian-split-squat-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-bulgarian-split-squat-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-bulgarian-split-squat-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-bulgarian-split-squat-side.mp4'] },
	{ id: 177, images : ['https://media.musclewiki.com/media/uploads/male-dumbbell-chest-fly-front.gif', 'https://media.musclewiki.com/media/uploads/male-dumbbell-chest-fly-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-chest-fly-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-chest-fly-side.mp4'] },
	{ id: 178, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-curl-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-curl-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-curl-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-curl-side.mp4'] },
	{ id: 179, images : ['https://media.musclewiki.com/media/uploads/male-dumbbell-decline-guillotine-bench-press-front.gif', 'https://media.musclewiki.com/media/uploads/male-dumbbell-decline-guillotine-bench-press-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-decline-guillotine-bench-press-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-decline-guillotine-bench-press-side.mp4'] },
	{ id: 180, images : ['https://media.musclewiki.com/media/uploads/male-dumbbell-goblet-squat-front.gif', 'https://media.musclewiki.com/media/uploads/male-dumbbell-goblet-squat-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-goblet-squat-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-goblet-squat-side.mp4'] },
	{ id: 181, images : ['https://media.musclewiki.com/media/uploads/male-dumbbell-guillotine-bench-press-front.gif', 'https://media.musclewiki.com/media/uploads/male-dumbbell-guillotine-bench-press-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-guillotine-bench-press-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-guillotine-bench-press-side.mp4'] },
	{ id: 182, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-guillotine-incline-bench-press-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-guillotine-incline-bench-press-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-guillotine-incline-bench-press-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-guillotine-incline-bench-press-front.mp4'] },
	{ id: 183, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-hammer-curl-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-hammer-curl-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-hammer-curl-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-hammer-curl-side.mp4'] },
	{ id: 184, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-hip-thrust-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-hip-thrust-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-hip-thrust-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-hip-thrust-front.mp4'] },
	{ id: 185, images : ['https://media.musclewiki.com/media/uploads/male-dumbbell-incline-bench-press-front_cgVhrMN.gif', 'https://media.musclewiki.com/media/uploads/male-dumbbell-incline-bench-press-side_VkZGG37.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-incline-bench-press-front_q2q0T12.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-incline-bench-press-side_2HBfFN3.mp4'] },
	{ id: 186, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-incline-curl-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-incline-curl-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-incline-curl-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-incline-curl-side.mp4'] },
	{ id: 187, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-incline-skullover-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-incline-skullover-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-incline-skullover-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-incline-skullover-front.mp4'] },
	{ id: 188, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-kneeling-single-arm-row-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-kneeling-single-arm-row-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-kneeling-single-arm-row-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-kneeling-single-arm-row-side.mp4'] },
	{ id: 189, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-lateral-raise-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-lateral-raise-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-lateral-raise-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-lateral-raise-side.mp4'] },
	{ id: 190, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-rear-delt-fly-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-rear-delt-fly-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-rear-delt-fly-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-rear-delt-fly-front.mp4'] },
	{ id: 191, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-reverse-lunge-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-reverse-lunge-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-reverse-lunge-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-reverse-lunge-front.mp4'] },
	{ id: 192, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-romanian-deadlift-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-romanian-deadlift-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-romanian-deadlift-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-romanian-deadlift-side.mp4'] },
	{ id: 193, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-russian-twist-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-russian-twist-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-russian-twist-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-russian-twist-front.mp4'] },
	{ id: 194, images : ['https://media.musclewiki.com/media/uploads/male-dumbbell-seated-overhead-press-front.gif', 'https://media.musclewiki.com/media/uploads/male-dumbbell-seated-overhead-press-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-seated-overhead-press-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-seated-overhead-press-side.mp4'] },
	{ id: 195, images : ['https://media.musclewiki.com/media/uploads/og-male-dumbbell-side-bend-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-dumbbell-side-bend-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-side-bend-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-side-bend-side.mp4'] },
	{ id: 196, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-single-arm-row-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-single-arm-row-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-single-arm-row-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-single-arm-row-side.mp4'] },
	{ id: 197, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-single-leg-heels-elevated-hip-thrust-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-single-leg-heels-elevated-hip-thrust-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-single-leg-heels-elevated-hip-thrust-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-single-leg-heels-elevated-hip-thrust-side.mp4'] },
	{ id: 198, images : ['https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-step-up-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Dumbbells-dumbbell-step-up-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-step-up-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Dumbbells-dumbbell-step-up-front.mp4'] },
	{ id: 199, images : ['https://media.musclewiki.com/media/nofile.gif', 'https://media.musclewiki.com/media/nofile.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-elbow-side-plank-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-elbow-side-plank-side.mp4'] },
	{ id: 200, images : ['https://media.musclewiki.com/media/uploads/male-bodyweight-forearm-plank-front_9t1UHBy.gif', 'https://media.musclewiki.com/media/uploads/male-bodyweight-forearm-plank-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-forearm-plank-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-forearm-plank-side.mp4'] },
	{ id: 201, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-glute-bridge-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-glute-bridge-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-glute-bridge-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-glute-bridge-front.mp4'] },
	{ id: 202, images : ['https://media.musclewiki.com/media/uploads/og-male-Recovery-hamstring-bridge-with-elevated-legs-box-bilateral-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Recovery-hamstring-bridge-with-elevated-legs-box-bilateral-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Recovery-hamstring-bridge-with-elevated-legs-box-bilateral-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Recovery-hamstring-bridge-with-elevated-legs-box-bilateral-side.mp4'] },
	{ id: 203, images : ['https://media.musclewiki.com/media/nofile.gif', 'https://media.musclewiki.com/media/nofile.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-hand-plank-side_GnZ2NZh.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-hand-plank-front_ZnMlFBF.mp4'] },
	{ id: 204, images : ['https://media.musclewiki.com/media/nofile.gif', 'https://media.musclewiki.com/media/nofile.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-hand-side-plank-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-hand-side-plank-side.mp4'] },
	{ id: 205, images : ['https://media.musclewiki.com/media/uploads/male-bodyweight-hanging-knee-raises-front.gif', 'https://media.musclewiki.com/media/uploads/male-bodyweight-hanging-knee-raises-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-hanging-knee-raises-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-hanging-knee-raises-side.mp4'] },
	{ id: 206, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-incline-push-up-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-incline-push-up-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-incline-push-up-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-incline-push-up-side.mp4'] },
	{ id: 207, images : ['https://media.musclewiki.com/media/uploads/male-bodyweight-reverse-row-front.gif', 'https://media.musclewiki.com/media/uploads/male-bodyweight-reverse-row-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-reverse-row-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-reverse-row-side.mp4'] },
	{ id: 208, images : ['https://media.musclewiki.com/media/uploads/og-male-Kettlebells-kettlebell-farmers-carry-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Kettlebells-kettlebell-farmers-carry-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Kettlebells-kettlebell-farmers-carry-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Kettlebells-kettlebell-farmers-carry-front.mp4'] },
	{ id: 209, images : ['https://media.musclewiki.com/media/uploads/og-male-Kettlebells-kettlebell-goblet-squat-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Kettlebells-kettlebell-goblet-squat-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Kettlebells-kettlebell-goblet-squat-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Kettlebells-kettlebell-goblet-squat-side.mp4'] },
	{ id: 210, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-laying-leg-raises-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-laying-leg-raises-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-laying-leg-raises-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-laying-leg-raises-side.mp4'] },
	{ id: 211, images : ['https://media.musclewiki.com/media/uploads/male-machine-hamstring-curl-front.gif', 'https://media.musclewiki.com/media/uploads/male-machine-hamstring-curl-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-machine-hamstring-curl-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-machine-hamstring-curl-side.mp4'] },
	{ id: 212, images : ['https://media.musclewiki.com/media/uploads/male-machine-leg-extension-front.gif', 'https://media.musclewiki.com/media/uploads/male-machine-leg-extension-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-machine-leg-extension-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-machine-leg-extension-side.mp4'] },
	{ id: 214, images : ['https://media.musclewiki.com/media/uploads/og-male-Machine-machine-neutral-row-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Machine-machine-neutral-row-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Machine-machine-neutral-row-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Machine-machine-neutral-row-side.mp4'] },
	{ id: 215, images : ['https://media.musclewiki.com/media/uploads/og-male-Machine-machine-pec-fly-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Machine-machine-pec-fly-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Machine-machine-pec-fly-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Machine-machine-pec-fly-front.mp4'] },
	{ id: 216, images : ['https://media.musclewiki.com/media/uploads/og-male-Machine-machine-reverse-fly-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Machine-machine-reverse-fly-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Machine-machine-reverse-fly-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Machine-machine-reverse-fly-side.mp4'] },
	{ id: 217, images : ['https://media.musclewiki.com/media/uploads/male-machine-seated-cable-row-front.gif', 'https://media.musclewiki.com/media/uploads/male-machine-seated-cable-row-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-machine-seated-cable-row-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-machine-seated-cable-row-side.mp4'] },
	{ id: 218, images : ['https://media.musclewiki.com/media/uploads/male-machine-seated-calf-raise-front.gif', 'https://media.musclewiki.com/media/uploads/male-machine-seated-calf-raise-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-machine-seated-calf-raise-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-machine-seated-calf-raise-side.mp4'] },
	{ id: 219, images : ['https://media.musclewiki.com/media/uploads/male-machine-standing-calf-raises-front.gif', 'https://media.musclewiki.com/media/uploads/male-machine-standing-calf-raises-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-machine-standing-calf-raises-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-machine-standing-calf-raises-side.mp4'] },
	{ id: 220, images : ['https://media.musclewiki.com/media/uploads/og-male-bodyweight-mountain-climber-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-bodyweight-mountain-climber-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-mountain-climber-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-mountain-climber-side.mp4'] },
	{ id: 221, images : ['https://media.musclewiki.com/media/uploads/og-male-Machine-narrow-pulldown-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Machine-narrow-pulldown-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Machine-narrow-pulldown-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Machine-narrow-pulldown-side.mp4'] },
	{ id: 222, images : ['https://media.musclewiki.com/media/uploads/male-bodyweight-pullup-front.gif', 'https://media.musclewiki.com/media/uploads/male-bodyweight-pullup-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-pullup-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-pullup-side.mp4'] },
	{ id: 223, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-push-up-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-push-up-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-push-up-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-push-up-side.mp4'] },
	{ id: 224, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-single-legged-romanian-deadlifts-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-single-legged-romanian-deadlifts-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-single-legged-romanian-deadlifts-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-single-legged-romanian-deadlifts-side.mp4'] },
	{ id: 225, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-situp-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-situp-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-situp-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-situp-front.mp4'] },
	{ id: 226, images : ['https://media.musclewiki.com/media/uploads/og-male-Smithmachine-assisted-pullup-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Smithmachine-assisted-pullup-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Smithmachine-assisted-pullup-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Smithmachine-assisted-pullup-side.mp4'] },
	{ id: 227, images : ['https://media.musclewiki.com/media/uploads/og-male-Smithmachine-bench-press-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Smithmachine-bench-press-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Smithmachine-bench-press-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Smithmachine-bench-press-front.mp4'] },
	{ id: 228, images : ['https://media.musclewiki.com/media/uploads/og-male-Smithmachine-calf-raise-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Smithmachine-calf-raise-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Smithmachine-calf-raise-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Smithmachine-calf-raise-side.mp4'] },
	{ id: 229, images : ['https://media.musclewiki.com/media/uploads/og-male-Smithmachine-drag-curl-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Smithmachine-drag-curl-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Smithmachine-drag-curl-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Smithmachine-drag-curl-side.mp4'] },
	{ id: 230, images : ['https://media.musclewiki.com/media/uploads/og-male-Smithmachine-hip-thrust-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Smithmachine-hip-thrust-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Smithmachine-hip-thrust-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Smithmachine-hip-thrust-front.mp4'] },
	{ id: 231, images : ['https://media.musclewiki.com/media/uploads/og-male-Smithmachine-inverted-row-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Smithmachine-inverted-row-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Smithmachine-inverted-row-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Smithmachine-inverted-row-front.mp4'] },
	{ id: 232, images : ['https://media.musclewiki.com/media/uploads/og-male-Smithmachine-seated-calf-raise-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Smithmachine-seated-calf-raise-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Smithmachine-seated-calf-raise-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Smithmachine-seated-calf-raise-front.mp4'] },
	{ id: 233, images : ['https://media.musclewiki.com/media/uploads/og-male-Smithmachine-side-bend-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Smithmachine-side-bend-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Smithmachine-side-bend-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Smithmachine-side-bend-side.mp4'] },
	{ id: 234, images : ['https://media.musclewiki.com/media/uploads/og-male-Smithmachine-sissy-squat-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Smithmachine-sissy-squat-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Smithmachine-sissy-squat-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Smithmachine-sissy-squat-side.mp4'] },
	{ id: 235, images : ['https://media.musclewiki.com/media/uploads/og-male-Smithmachine-squat-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Smithmachine-squat-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Smithmachine-squat-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Smithmachine-squat-front.mp4'] },
	{ id: 236, images : ['https://media.musclewiki.com/media/uploads/og-male-Smithmachine-staggered-deadlift-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Smithmachine-staggered-deadlift-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Smithmachine-staggered-deadlift-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Smithmachine-staggered-deadlift-front.mp4'] },
	{ id: 237, images : ['https://media.musclewiki.com/media/uploads/male-standing-smith-machine-shrugs-front.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-standing-smith-machine-shrugs-front.mp4'] },
	{ id: 238, images : ['https://media.musclewiki.com/media/uploads/og-male-Smithmachine-upright-row-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Smithmachine-upright-row-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Smithmachine-upright-row-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Smithmachine-upright-row-side.mp4'] },
	{ id: 239, images : ['https://media.musclewiki.com/media/uploads/male-bodyweight-split-squat-front.gif', 'https://media.musclewiki.com/media/uploads/male-bodyweight-split-squat-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-split-squat-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-bodyweight-split-squat-side.mp4'] },
	{ id: 240, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-bodyweight-reverse-lunge-side.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-bodyweight-reverse-lunge-front.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-bodyweight-reverse-lunge-side.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-bodyweight-reverse-lunge-front.mp4'] },
	{ id: 241, images : ['https://media.musclewiki.com/media/uploads/male-dumbbell-seated-overhead-press-front.gif', 'https://media.musclewiki.com/media/uploads/male-dumbbell-seated-overhead-press-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-seated-overhead-press-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-dumbbell-seated-overhead-press-side.mp4'] },
	{ id: 242, images : ['https://media.musclewiki.com/media/uploads/male-machine-hamstring-curl-front.gif', 'https://media.musclewiki.com/media/uploads/male-machine-hamstring-curl-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-machine-hamstring-curl-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-machine-hamstring-curl-side.mp4'] },
	{ id: 243, images : ['https://media.musclewiki.com/media/uploads/male-machine-seated-cable-row-front.gif', 'https://media.musclewiki.com/media/uploads/male-machine-seated-cable-row-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-machine-seated-cable-row-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-machine-seated-cable-row-side.mp4'] },
	{ id: 244, images : ['https://media.musclewiki.com/media/uploads/male-machine-seated-calf-raise-front.gif', 'https://media.musclewiki.com/media/uploads/male-machine-seated-calf-raise-side.gif'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-machine-seated-calf-raise-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-machine-seated-calf-raise-side.mp4'] },
	{ id: 245, images : ['https://media.musclewiki.com/media/uploads/og-male-Bodyweight-push-up-front.jpg', 'https://media.musclewiki.com/media/uploads/og-male-Bodyweight-push-up-side.jpg'], videos : ['https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-push-up-front.mp4', 'https://media.musclewiki.com/media/uploads/videos/branded/male-Bodyweight-push-up-side.mp4'] },
	
	{id: 252, images: ['https://wger.de/media/exercise-images/1189/3bdbbafd-17eb-4226-abba-222a782ae97e.jpg'],},
	{id: 253, images: ['https://wger.de/media/exercise-images/1561/cada72fe-2502-4bf7-abd3-adc8545124a1.png'],},
	{id: 258, images: ['https://wger.de/media/exercise-images/1012/8270fdb8-28f1-4eff-b410-af8642085b3f.png'],},
	{id: 259, images: ['https://wger.de/media/exercise-images/1192/651a4535-8210-4dbd-8f06-61d95fdd9963.png'],},
	{id: 262, images: ['https://wger.de/media/exercise-images/1564/97749b4f-97be-43ab-bff1-9f0dd7478cf3.png'],},
	{id: 264, images: ['https://wger.de/media/exercise-images/1141/c7be1cd1-46c5-4a86-a114-5f0fe861c3e0.jpg'],},
	{id: 272, images: ['https://wger.de/media/exercise-images/1143/6e21cb6c-da09-4bcd-b9d2-1ef75237b763.png'],},
	{id: 281, images: ['https://wger.de/media/exercise-images/1295/e02de0a3-20d5-4452-9fd1-66163a10c3a2.jpg'],},
	{id: 289, images: ['https://wger.de/media/exercise-images/50/695ced5c-9961-4076-add2-cb250d01089e.png', 'https://wger.de/media/exercise-images/50/44cf2c72-a78a-4d5e-a8b5-a02c6ea61fb4.jpg', 'https://wger.de/media/exercise-images/50/60c68ac5-70c7-4ed6-bfc1-99bed63a472a.jpg', 'https://wger.de/media/exercise-images/50/69b519d8-4861-4bb1-b504-3887aa30e7d8.png'],},
	{id: 292, images: ['https://wger.de/media/exercise-images/1212/53105f26-a9b2-4b01-824b-a326bb00c6da.jpeg'],},
	{id: 296, images: ['https://wger.de/media/exercise-images/192/Bench-press-1.png', 'https://wger.de/media/exercise-images/192/Bench-press-2.png'],},
	{id: 297, images: ['https://wger.de/media/exercise-images/88/Narrow-grip-bench-press-1.png', 'https://wger.de/media/exercise-images/88/Narrow-grip-bench-press-2.png'],},
	{id: 298, images: ['https://wger.de/media/exercise-images/97/Dumbbell-bench-press-1.png', 'https://wger.de/media/exercise-images/97/Dumbbell-bench-press-2.png'],},
	{id: 301, images: ['https://wger.de/media/exercise-images/81/a751a438-ae2d-4751-8d61-cef0e9292174.png'],},
	{id: 303, images: ['https://wger.de/media/exercise-images/109/Barbell-rear-delt-row-1.png', 'https://wger.de/media/exercise-images/109/Barbell-rear-delt-row-2.png'],},
	{id: 304, images: ['https://wger.de/media/exercise-images/70/Reverse-grip-bent-over-rows-1.png', 'https://wger.de/media/exercise-images/70/Reverse-grip-bent-over-rows-2.png'],},
	{id: 305, images: ['https://wger.de/media/exercise-images/110/Reverse-grip-bent-over-rows-1.png', 'https://wger.de/media/exercise-images/110/Reverse-grip-bent-over-rows-2.png'],},
	{id: 310, images: ['https://wger.de/media/exercise-images/129/Standing-biceps-curl-1.png', 'https://wger.de/media/exercise-images/129/Standing-biceps-curl-2.png'],},
	{id: 311, images: ['https://wger.de/media/exercise-images/1334/f2774748-b1c4-43b9-822f-b39f516ba848.webp'],},
	{id: 312, images: ['https://wger.de/media/exercise-images/74/Bicep-curls-1.png', 'https://wger.de/media/exercise-images/74/Bicep-curls-2.png'],},
	{id: 313, images: ['https://wger.de/media/exercise-images/81/Biceps-curl-1.png', 'https://wger.de/media/exercise-images/81/Biceps-curl-2.png'],},
	{id: 314, images: ['https://wger.de/media/exercise-images/94/6dee2f60-aea2-4f2d-9bf6-aef50c4f9483.png'],},
	{id: 315, images: ['https://wger.de/media/exercise-images/958/947ac249-475d-44ed-bed3-8dc433374f59.png', 'https://wger.de/media/exercise-images/958/95f2bbc4-2f95-476d-a9b8-81b333fe2ef5.png', 'https://wger.de/media/exercise-images/958/dfad24f7-3f6f-497c-8436-7dfd909bca3f.png'],},
	{id: 317, images: ['https://wger.de/media/exercise-images/1572/3d14e761-a73d-49da-8804-f3016a7573ff.png'],},
	{id: 320, images: ['https://wger.de/media/exercise-images/1363/1dba566b-e799-4bde-abb0-c011a3c75e52.webp'],},
	{id: 332, images: ['https://wger.de/media/exercise-images/988/6283b258-a4d7-4833-84f7-a38987022d3d.png'],},
	{id: 336, images: ['https://wger.de/media/exercise-images/98/Butterfly-machine-2.png', 'https://wger.de/media/exercise-images/98/Butterfly-machine-1.png'],},
	{id: 337, images: ['https://wger.de/media/exercise-images/1354/67424990-3051-4e0d-9904-c69e2308af4d.webp'],},
	{id: 341, images: ['https://wger.de/media/exercise-images/1109/00b0a0bf-c14a-4f13-bb14-62c09030a1aa.png'],},
	{id: 342, images: ['https://wger.de/media/exercise-images/71/Cable-crossover-2.png', 'https://wger.de/media/exercise-images/71/Cable-crossover-1.png'],},
	{id: 346, images: ['https://wger.de/media/exercise-images/1378/7c1fcf34-fb7e-45e7-a0c1-51f296235315.jpg'],},
	{id: 348, images: ['https://wger.de/media/exercise-images/822/74affc0d-03b6-4f33-b5f4-a822a2615f68.png', 'https://wger.de/media/exercise-images/822/6a770e5d-cd62-4754-a18c-eebe2103d7c5.png'],},
	{id: 349, images: ['https://wger.de/media/exercise-images/1351/c5fdc7d2-4a03-424f-96ea-ab7fbd6bdefe.webp'],},
	{id: 360, images: ['https://wger.de/media/exercise-images/1557/226f4a44-6522-47a5-9053-9fc4967b1a33.jpg'],},
	{id: 361, images: ['https://wger.de/media/exercise-images/1618/c18baedc-ff98-4fb2-b4f5-38a05c12f637.png'],},
	{id: 366, images: ['https://wger.de/media/exercise-images/181/Chin-ups-2.png', 'https://wger.de/media/exercise-images/181/Chin-ups-1.png'],},
	{id: 367, images: ['https://wger.de/media/exercise-images/1554/49207a62-8799-4b47-8c0b-7bde02926f3d.png'],},
	{id: 368, images: ['https://wger.de/media/exercise-images/1223/bf20836a-23b0-4f50-8b98-cfdd97684527.webp'],},
	{id: 374, images: ['https://wger.de/media/exercise-images/1086/b2ee8d9b-0480-4992-8494-c223b37c2696.jpg'],},
	{id: 384, images: ['https://wger.de/media/exercise-images/1617/49a6372b-8a67-4856-b7a6-15896a409ad2.gif'],},
	{id: 385, images: ['https://wger.de/media/exercise-images/91/Crunches-1.png', 'https://wger.de/media/exercise-images/91/Crunches-2.png'],},
	{id: 390, images: ['https://wger.de/media/exercise-images/1567/0a8c155c-a48e-47e8-9df3-e39f025c6cad.png'],},
	{id: 391, images: ['https://wger.de/media/exercise-images/1139/e2962bcc-2f65-4d7e-8ea5-594ee0999a7a.png'],},
	{id: 392, images: ['https://wger.de/media/exercise-images/1560/3e9039c2-a939-4c64-a246-b337960d2dd1.png'],},
	{id: 393, images: ['https://wger.de/media/exercise-images/1190/c05818bf-1c81-46df-9f24-42e354265388.png'],},
	{id: 394, images: ['https://wger.de/media/exercise-images/1128/a591b67c-9c1b-451c-8bac-bc57922f7104.png'],},
	{id: 395, images: ['https://wger.de/media/exercise-images/1142/2999fcfb-e691-4f4b-b3e5-5f44288cadf0.PNG'],},
	{id: 396, images: ['https://wger.de/media/exercise-images/1568/14379742-59ac-4dc7-be39-92db6cd2fd50.png'],},
	{id: 407, images: ['https://wger.de/media/exercise-images/184/1709c405-620a-4d07-9658-fade2b66a2df.jpeg'],},
	{id: 408, images: ['https://wger.de/media/exercise-images/100/Decline-bench-press-1.png', 'https://wger.de/media/exercise-images/100/Decline-bench-press-2.png'],},
	{id: 413, images: ['https://wger.de/media/exercise-images/1556/a23c820b-e08b-4911-a6a4-80f16c15d2e0.png'],},
	{id: 416, images: ['https://wger.de/media/exercise-images/194/34600351-8b0b-4cb0-8daa-583537be15b0.png'],},
	{id: 417, images: ['https://wger.de/media/exercise-images/83/Bench-dips-1.png', 'https://wger.de/media/exercise-images/83/Bench-dips-2.png'],},
	{id: 420, images: ['https://wger.de/media/exercise-images/1243/53d4fabe-c994-4907-873f-8d82813a9832.png'],},
	{id: 426, images: ['https://wger.de/media/exercise-images/1085/2f9a9f90-ea2e-4f3f-b8ca-19aea162fe2d.jpg'],},
	{id: 427, images: ['https://wger.de/media/exercise-images/1226/a6154dbd-67a0-4a36-8748-0f5af3865e83.jpg'],},
	{id: 430, images: ['https://wger.de/media/exercise-images/1352/968872e8-6380-430c-bf99-fdb28b5559af.webp'],},
	{id: 437, images: ['https://wger.de/media/exercise-images/1084/91dd5a95-1c45-46f2-a074-de41b6ad599b.jpg'],},
	{id: 440, images: ['https://wger.de/media/exercise-images/203/1c052351-2af0-4227-aeb0-244008e4b0a8.jpeg', 'https://wger.de/media/exercise-images/203/2ab30113-4e08-4d39-9d23-d901ce2c0971.jpeg', 'https://wger.de/media/exercise-images/203/300a44ac-4368-48e2-8b18-beea32ab915d.gif'],},
	{id: 441, images: ['https://wger.de/media/exercise-images/1087/d85f4e02-b20c-457c-bdfb-0b00e2d14150.jpg'],},
	{id: 442, images: ['https://wger.de/media/exercise-images/1353/138cb483-7d4d-4519-b029-63e4269810a6.webp'],},
	{id: 443, images: ['https://wger.de/media/exercise-images/1614/7f3cfae2-e062-4211-9a6b-5a10851ce7f4.jpg', 'https://wger.de/media/exercise-images/1614/d5ebadd8-f676-427f-b755-6a0679c19265.jpg'],},
	{id: 447, images: ['https://wger.de/media/exercise-images/113/Walking-lunges-1.png', 'https://wger.de/media/exercise-images/113/Walking-lunges-2.png', 'https://wger.de/media/exercise-images/113/Walking-lunges-3.png', 'https://wger.de/media/exercise-images/113/Walking-lunges-4.png'],},
	{id: 450, images: ['https://wger.de/media/exercise-images/1227/57415c3c-2963-4130-9f6f-79f6a96113b6.gif'],},
	{id: 451, images: ['https://wger.de/media/exercise-images/1362/65bd3b6e-6c33-43d3-bb05-cc05d5a834e8.webp'],},
	{id: 456, images: ['https://wger.de/media/exercise-images/1088/9f66b288-ce8f-4154-ba80-78fee267263c.jpg'],},
	{id: 459, images: ['https://wger.de/media/exercise-images/1229/1e6f611c-ed53-48f1-8fdd-3b92ae3579c3.webp'],},
	{id: 460, images: ['https://wger.de/media/exercise-images/1225/39a0b7e7-9780-425d-84f5-56d10d1690ac.gif'],},
	{id: 465, images: ['https://wger.de/media/exercise-images/1123/91bc8423-7bb9-4536-9603-651cbed283f6.png'],},
	{id: 466, images: ['https://wger.de/media/exercise-images/1122/863a5589-dd36-4093-95c5-2b3511d34abc.png'],},
	{id: 467, images: ['https://wger.de/media/exercise-images/1566/04556676-5c9c-4e7f-b22c-33a167e3334d.png'],},
	{id: 468, images: ['https://wger.de/media/exercise-images/1565/739a9c58-e8b4-4f69-8fe0-d8cdb2334dbe.png'],},
	{id: 469, images: ['https://wger.de/media/exercise-images/1571/45042d13-dd22-4577-8988-3d75b77c08b9.gif', 'https://wger.de/media/exercise-images/1571/241cb70b-e8b3-4401-b4f8-cc62fc55dc5b.gif'],},
	{id: 477, images: ['https://wger.de/media/exercise-images/1131/3bcf3024-2dcc-4995-9694-55aa2c2e4a9a.png'],},
	{id: 478, images: ['https://wger.de/media/exercise-images/1297/a2f17a04-5523-4aa3-bce3-6b284807c126.png'],},
	{id: 480, images: ['https://wger.de/media/exercise-images/1217/590e65db-de60-4727-b7eb-55f80af56043.png'],},
	{id: 482, images: ['https://wger.de/media/exercise-images/1188/43e714e4-b736-4f3a-8ab4-97821fdff86a.jpg'],},
	{id: 484, images: ['https://wger.de/media/exercise-images/1000/553266a8-a972-48c5-a014-b12afac66f65.png'],},
	{id: 487, images: ['https://wger.de/media/exercise-images/122/Incline-cable-flyes-1.png', 'https://wger.de/media/exercise-images/122/Incline-cable-flyes-2.png'],},
	{id: 488, images: ['https://wger.de/media/exercise-images/238/2fc242d3-5bdd-4f97-99bd-678adb8c96fc.png', 'https://wger.de/media/exercise-images/238/c6464fb3-1924-4ff1-adfa-fd36da9b5d13.png'],},
	{id: 490, images: ['https://wger.de/media/exercise-images/1332/9e42facb-fc30-4c47-a41a-eef1d7b7b8cb.webp'],},
	{id: 491, images: ['https://wger.de/media/exercise-images/1333/89f43354-32e3-473a-9bcf-caca51f1a8e3.webp'],},
	{id: 503, images: ['https://wger.de/media/exercise-images/256/b7def5bc-2352-499b-b9e5-fff741003831.png'],},
	{id: 505, images: ['https://wger.de/media/exercise-images/191/Front-squat-1-857x1024.png', 'https://wger.de/media/exercise-images/191/Front-squat-2-857x1024.png'],},
	{id: 509, images: ['https://wger.de/media/exercise-images/1140/0c5e3506-0335-44ae-8ca9-87fd179a380f.png'],},
	{id: 513, images: ['https://wger.de/media/exercise-images/116/Good-mornings-2.png', 'https://wger.de/media/exercise-images/116/Good-mornings-1.png'],},
	{id: 515, images: ['https://wger.de/media/exercise-images/86/Bicep-hammer-curl-1.png', 'https://wger.de/media/exercise-images/86/Bicep-hammer-curl-2.png'],},
	{id: 516, images: ['https://wger.de/media/exercise-images/138/Hammer-curls-with-rope-1.png', 'https://wger.de/media/exercise-images/138/Hammer-curls-with-rope-2.png'],},
	{id: 518, images: ['https://wger.de/media/exercise-images/1387/a2cf7eda-5540-4105-b30e-1c2f2679a6c7.png'],},
	{id: 520, images: ['https://wger.de/media/exercise-images/1331/845e4fde-3a39-4026-b5b7-7527c79fd713.webp'],},
	{id: 535, images: ['https://wger.de/media/exercise-images/1187/cd16b706-b9d2-47a7-81cf-a27724017d89.jpg'],},
	{id: 537, images: ['https://wger.de/media/exercise-images/1298/ec4b83ec-5a8f-4303-9050-99ec4389bc2a.png'],},
	{id: 539, images: ['https://wger.de/media/exercise-images/1080/c4bf7ba1-6058-4d14-928f-7187885d5d57.webp'],},
	{id: 547, images: ['https://wger.de/media/exercise-images/128/Hyperextensions-1.png', 'https://wger.de/media/exercise-images/128/Hyperextensions-2.png'],},
	{id: 549, images: ['https://wger.de/media/exercise-images/41/Incline-bench-press-1.png', 'https://wger.de/media/exercise-images/41/Incline-bench-press-2.png', 'https://wger.de/media/exercise-images/538/a1c23996-c8aa-42e3-9dfc-bed0654d849f.png'],},
	{id: 550, images: ['https://wger.de/media/exercise-images/16/Incline-press-1.png', 'https://wger.de/media/exercise-images/16/Incline-press-2.png'],},
	{id: 551, images: ['https://wger.de/media/exercise-images/61/Close-grip-bench-press-1.png', 'https://wger.de/media/exercise-images/61/Close-grip-bench-press-2.png'],},
	{id: 552, images: ['https://wger.de/media/exercise-images/828/2e959dab-f39b-4c7c-9063-eb43064ab5eb.png', 'https://wger.de/media/exercise-images/828/abfc7700-fadf-4f2d-ac84-e045e590a2fe.png'],},
	{id: 554, images: ['https://wger.de/media/exercise-images/1283/e7262f70-7512-408a-8d00-4c499ef632fc.jpg'],},
	{id: 556, images: ['https://wger.de/media/exercise-images/56/Decline-crunch-1.png', 'https://wger.de/media/exercise-images/56/Decline-crunch-2.png'],},
	{id: 557, images: ['https://wger.de/media/exercise-images/1276/8900b22a-98b1-4cb7-975a-ed506c2d9a7c.png'],},
	{id: 559, images: ['https://wger.de/media/exercise-images/1277/9f3c7817-3e3d-417d-8b08-2c0a1aa5fe03.jpg'],},
	{id: 565, images: ['https://wger.de/media/exercise-images/1198/864906ac-4ac7-4e52-a886-c6bb97950a9f.jpg'],},
	{id: 571, images: ['https://wger.de/media/exercise-images/1558/99e38ebc-eff6-4e87-b5d5-20ac835f07b5.png'],},
	{id: 572, images: ['https://wger.de/media/exercise-images/1126/0d51a0f2-622f-434b-beb8-1a003c54712a.png'],},
	{id: 573, images: ['https://wger.de/media/exercise-images/1127/4942b7c0-6bda-4983-88e5-86547c3d445e.png'],},
	{id: 574, images: ['https://wger.de/media/exercise-images/1138/6c35fd79-ef35-4cf3-abf5-9c969457b8d4.PNG'],},
	{id: 575, images: ['https://wger.de/media/exercise-images/1136/5778a8e9-c606-4843-89c8-9d9469eeb6e4.PNG'],},
	{id: 584, images: ['https://wger.de/media/exercise-images/1612/3dc33f57-2786-4305-8b91-e011d7055923.jpg', 'https://wger.de/media/exercise-images/1612/e719b872-d122-4e2d-be17-bd2babfe457a.jpg'],},
	{id: 599, images: ['https://wger.de/media/exercise-images/1350/10d40662-86eb-4b7d-99f5-a7fba47bb660.webp'],},
	{id: 601, images: ['https://wger.de/media/exercise-images/1349/c754703d-c572-4179-824f-9faef91a7b62.webp'],},
	{id: 603, images: ['https://wger.de/media/exercise-images/1325/d8372291-6725-452a-9711-6321c061e354.jpg'],},
	{id: 604, images: ['https://wger.de/media/exercise-images/148/lateral-dumbbell-raises-large-2.png', 'https://wger.de/media/exercise-images/148/lateral-dumbbell-raises-large-1.png'],},
	{id: 605, images: ['https://wger.de/media/exercise-images/349/9d969203-9cb6-4d47-9c31-fef53bfe1de5.png', 'https://wger.de/media/exercise-images/349/8dc5ad63-a93a-496f-9473-ac414236e58d.png', 'https://wger.de/media/exercise-images/349/7359ab6a-72a4-4ed8-b7da-35d57aaa2199.png', 'https://wger.de/media/exercise-images/349/d74d171e-d39a-4c13-bbcd-6821bc94d424.png'],},
	{id: 610, images: ['https://wger.de/media/exercise-images/364/b318dde9-f5f2-489f-940a-cd864affb9e3.png'],},
	{id: 612, images: ['https://wger.de/media/exercise-images/154/lying-leg-curl-machine-large-1.png', 'https://wger.de/media/exercise-images/154/lying-leg-curl-machine-large-2.png'],},
	{id: 613, images: ['https://wger.de/media/exercise-images/117/seated-leg-curl-large-1.png', 'https://wger.de/media/exercise-images/117/seated-leg-curl-large-2.png'],},
	{id: 614, images: ['https://wger.de/media/exercise-images/118/standing-leg-curls-large-1.png', 'https://wger.de/media/exercise-images/118/standing-leg-curls-large-2.png'],},
	{id: 615, images: ['https://wger.de/media/exercise-images/369/78c915d1-e46d-4d30-8124-65d68664c3ef.png'],},
	{id: 618, images: ['https://wger.de/media/exercise-images/1364/683b0230-ec66-4eae-97f8-a28d249bcd26.webp'],},
	{id: 619, images: ['https://wger.de/media/exercise-images/130/Narrow-stance-hack-squats-1-1024x721.png', 'https://wger.de/media/exercise-images/130/Narrow-stance-hack-squats-2-1024x721.png'],},
	{id: 621, images: ['https://wger.de/media/exercise-images/373/60e2aa21-1910-40d3-9fed-babfee06dd48.png'],},
	{id: 625, images: ['https://wger.de/media/exercise-images/125/Leg-raises-2.png', 'https://wger.de/media/exercise-images/125/Leg-raises-1.png'],},
	{id: 627, images: ['https://wger.de/media/exercise-images/1342/eadcea2e-420d-4b55-be33-ac4e6d83c30a.webp'],},
	{id: 628, images: ['https://wger.de/media/exercise-images/1343/95bba61a-3890-4395-9414-881c4738589a.webp'],},
	{id: 629, images: ['https://wger.de/media/exercise-images/1340/67b250eb-8d9d-4173-9478-6e2c11fc9ac6.webp'],},
	{id: 630, images: ['https://wger.de/media/exercise-images/1341/8604191d-2742-4d05-ae89-dacbaf731df8.webp'],},
	{id: 634, images: ['https://wger.de/media/exercise-images/143/Cable-seated-rows-2.png', 'https://wger.de/media/exercise-images/143/Cable-seated-rows-1.png'],},
	{id: 640, images: ['https://wger.de/media/exercise-images/1296/c42782fe-337a-44f4-9079-7f6dedab4885.png'],},
	{id: 641, images: ['https://wger.de/media/exercise-images/1348/a3769120-2445-49f2-97d3-afc1238bfc2a.webp'],},
	{id: 642, images: ['https://wger.de/media/exercise-images/984/5c7ffe68-e7b2-47f3-a22a-f9cc28640432.png'],},
	{id: 655, images: ['https://wger.de/media/exercise-images/1089/49f51716-535d-41dd-aeb5-cff5bb906bc1.jpeg'],},
	{id: 657, images: ['https://wger.de/media/exercise-images/418/fa2a2207-43cb-4dc0-bc2a-039e32544790.png'],},
	{id: 661, images: ['https://wger.de/media/exercise-images/93/Decline-crunch-1.png', 'https://wger.de/media/exercise-images/93/Decline-crunch-2.png'],},
	{id: 667, images: ['https://wger.de/media/exercise-images/1186/1987a039-cf35-437e-bbdc-40c53dd7d053.jpg'],},
	{id: 674, images: ['https://wger.de/media/exercise-images/1519/fab7f641-27d4-40b5-8edd-1a0a137bfd94.gif'],},
	{id: 675, images: ['https://wger.de/media/exercise-images/1194/074e1766-4208-4a67-a211-9721772d99b0.png'],},
	{id: 676, images: ['https://wger.de/media/exercise-images/1616/97e6fd98-2ca6-486f-b9b2-f0499fe38044.jpg'],},
	{id: 677, images: ['https://wger.de/media/exercise-images/1563/21b9574e-3cba-4a78-8ef3-73419fd44191.png'],},
	{id: 681, images: ['https://wger.de/media/exercise-images/1521/e4e4aa78-3c96-4b1d-95c0-f9f73a0779d0.webp'],},
	{id: 684, images: ['https://wger.de/media/exercise-images/1559/21ed39bf-ca69-409e-a958-536f8a1bad37.png'],},
	{id: 690, images: ['https://wger.de/media/exercise-images/456/3b681e59-377b-40db-9113-ca5873ce084b.jpg', 'https://wger.de/media/exercise-images/456/c51d875b-0c07-495e-a7cf-08893a9f125d.jpg', 'https://wger.de/media/exercise-images/456/93716d06-c378-49b8-820a-8bf3e1d7e45c.jpg', 'https://wger.de/media/exercise-images/456/b8f007b1-d43f-416d-a44b-fb3c15291414.jpg'],},
	{id: 694, images: ['https://wger.de/media/exercise-images/458/b7bd9c28-9f1d-4647-bd17-ab6a3adf5770.png', 'https://wger.de/media/exercise-images/458/902e6836-394e-458b-b94e-101d714294e2.png', 'https://wger.de/media/exercise-images/458/d1ca4a79-f299-4e70-a391-3e9526c3b141.png', 'https://wger.de/media/exercise-images/458/b180ce8b-a2c2-40da-924f-998d97aebb63.png', 'https://wger.de/media/exercise-images/458/167db646-9acb-4426-a383-c7e7dc92e3ec.png', 'https://wger.de/media/exercise-images/458/e13f92a4-69ae-4043-ae1f-70f155a53024.png', 'https://wger.de/media/exercise-images/458/bce9a15d-d080-4fb0-bc30-f80778b38793.png', 'https://wger.de/media/exercise-images/458/2c43d623-5898-4669-b5f8-eb3e1c38cd29.png', 'https://wger.de/media/exercise-images/458/122735cf-f940-4de8-aa30-49a1da148319.png'],},
	{id: 697, images: ['https://wger.de/media/exercise-images/1091/50c8912d-54ef-46c9-99d1-633b6196aa1e.jpg'],},
	{id: 700, images: ['https://wger.de/media/exercise-images/1275/0652d306-93eb-42f0-b564-7c3261ea809a.png'],},
	{id: 702, images: ['https://wger.de/media/exercise-images/1079/bdacc8ed-8fb0-4684-a28d-0348ec098bdf.jpg'],},
	{id: 704, images: ['https://wger.de/media/exercise-images/193/Preacher-curl-3-1.png', 'https://wger.de/media/exercise-images/193/Preacher-curl-3-2.png'],},
	{id: 705, images: ['https://wger.de/media/exercise-images/1570/4d497249-ee99-4424-9156-382ed07973e7.gif'],},
	{id: 707, images: ['https://wger.de/media/exercise-images/1133/e930c960-dd46-4ec3-8648-a54610d8a6ce.PNG'],},
	{id: 708, images: ['https://wger.de/media/exercise-images/1569/806e7d0c-2c50-476d-afab-a4cdd5a3ca59.gif'],},
	{id: 713, images: ['https://wger.de/media/exercise-images/1562/6974a22a-c9c1-47cb-a22a-9da906e519b1.png'],},
	{id: 714, images: ['https://wger.de/media/exercise-images/1137/42f22229-c0a0-4bfc-aca6-66fe5e1ab10d.PNG'],},
	{id: 717, images: ['https://wger.de/media/exercise-images/475/b0554016-16fd-4dbe-be47-a2a17d16ae0e.jpg'],},
	{id: 723, images: ['https://wger.de/media/exercise-images/478/70a2d72c-a822-45f3-8de2-54ea85951b84.jpg'],},
	{id: 724, images: ['https://wger.de/media/exercise-images/1551/a6a9e561-3965-45c6-9f2b-ee671e1a3a45.png'],},
	{id: 726, images: ['https://wger.de/media/exercise-images/1112/81f40bee-4adf-4317-8476-1a87706e3031.png'],},
	{id: 729, images: ['https://wger.de/media/exercise-images/957/0fd94587-6021-4763-856e-7227f5fcba2a.png'],},
	{id: 732, images: ['https://wger.de/media/exercise-images/161/Dead-lifts-2.png', 'https://wger.de/media/exercise-images/161/Dead-lifts-1.png'],},
	{id: 734, images: ['https://wger.de/media/exercise-images/829/ad724e5c-b1ed-49e8-9279-a17545b0dd0b.png', 'https://wger.de/media/exercise-images/829/692c598c-0493-42a5-be8b-b9d2e9adcd00.png'],},
	{id: 738, images: ['https://wger.de/media/exercise-images/1491/ca1bc68d-9c36-4dd3-8ec4-496c57b5c564.jpg'],},
	{id: 739, images: ['https://wger.de/media/exercise-images/1145/1325f24b-57ac-4102-ad56-489be1d7d516.PNG'],},
	{id: 740, images: ['https://wger.de/media/exercise-images/1144/65a5891a-424e-4fbe-bf3d-444509c97181.PNG'],},
	{id: 741, images: ['https://wger.de/media/exercise-images/1118/f6d036e1-dfc9-4f5d-a44d-71f057549ab9.png'],},
	{id: 742, images: ['https://wger.de/media/exercise-images/1119/9b138ad2-5b80-42a8-bfff-93a960444ffe.png'],},
	{id: 743, images: ['https://wger.de/media/exercise-images/1120/df9a5256-e977-44d0-bc9c-b53253faeb22.png'],},
	{id: 753, images: ['https://wger.de/media/exercise-images/999/d0931eb3-8db0-4049-bb08-aa4036072056.jfif', 'https://wger.de/media/exercise-images/999/8548b2d2-004d-48b4-95fd-b1b25f4e53d0.jfif'],},
	{id: 773, images: ['https://wger.de/media/exercise-images/106/T-bar-row-1.png', 'https://wger.de/media/exercise-images/106/T-bar-row-2.png'],},
	{id: 774, images: ['https://wger.de/media/exercise-images/1613/a851fe9d-771f-44da-82f0-799e02ae3fd1.jpg'],},
	{id: 778, images: ['https://wger.de/media/exercise-images/1335/c683a469-89a9-47ef-811c-a7d908c5a3a1.webp'],},
	{id: 779, images: ['https://wger.de/media/exercise-images/1193/70ca5d80-3847-4a8c-8882-c6e9e485e29e.png'],},
	{id: 781, images: ['https://wger.de/media/exercise-images/1338/9d157b4d-5af0-43c1-bd34-f52144ba1b54.webp'],},
	{id: 788, images: ['https://wger.de/media/exercise-images/1117/e74255c0-67a0-4309-b78d-2d79e6ff8c11.png'],},
	{id: 789, images: ['https://wger.de/media/exercise-images/921/2555c4c3-a84d-47db-b83b-cbf721f12e45.png'],},
	{id: 794, images: ['https://wger.de/media/exercise-images/1105/36776818-799a-40bf-9eca-aebb3aa5008f.png'],},
	{id: 795, images: ['https://wger.de/media/exercise-images/1106/7e4f1400-38ee-4d59-9e99-38a7d3548501.png'],},
	{id: 796, images: ['https://wger.de/media/exercise-images/1098/fa5328a2-64cb-4afb-a283-b3d948ddaf3f.jpg'],},
	{id: 801, images: ['https://wger.de/media/exercise-images/1337/981ec266-966e-4e16-8e9a-7b1c04979039.webp'],},
	{id: 802, images: ['https://wger.de/media/exercise-images/119/seated-barbell-shoulder-press-large-1.png', 'https://wger.de/media/exercise-images/119/seated-barbell-shoulder-press-large-2.png'],},
	{id: 803, images: ['https://wger.de/media/exercise-images/123/dumbbell-shoulder-press-large-1.png', 'https://wger.de/media/exercise-images/123/dumbbell-shoulder-press-large-2.png'],},
	{id: 804, images: ['https://wger.de/media/exercise-images/53/Shoulder-press-machine-2.png', 'https://wger.de/media/exercise-images/53/Shoulder-press-machine-1.png'],},
	{id: 809, images: ['https://wger.de/media/exercise-images/1347/1c18cdfc-1c44-4dcc-82ba-1a5d54a409ba.webp'],},
	{id: 811, images: ['https://wger.de/media/exercise-images/150/Barbell-shrugs-1.png', 'https://wger.de/media/exercise-images/150/Barbell-shrugs-2.png'],},
	{id: 812, images: ['https://wger.de/media/exercise-images/151/Dumbbell-shrugs-2.png', 'https://wger.de/media/exercise-images/151/Dumbbell-shrugs-1.png'],},
	{id: 814, images: ['https://wger.de/media/exercise-images/176/Cross-body-crunch-1.png', 'https://wger.de/media/exercise-images/176/Cross-body-crunch-2.png'],},
	{id: 824, images: ['https://wger.de/media/exercise-images/1582/5094fe30-eea2-4269-b0de-4b8a20558fd7.png'],},
	{id: 826, images: ['https://wger.de/media/exercise-images/1022/f74644fa-f43e-46bd-8603-6e3a2ee8ee2d.jpg', 'https://wger.de/media/exercise-images/1022/eef8fb9d-ae72-4e23-81da-4d62f2734332.jpg'],},
	{id: 836, images: ['https://wger.de/media/exercise-images/1330/28b05754-591a-4975-9cef-e6915243e1d4.webp'],},
	{id: 839, images: ['https://wger.de/media/exercise-images/1274/bcffdf52-3c36-4b0c-b787-fb84f20bf82d.png'],},
	{id: 843, images: ['https://wger.de/media/exercise-images/84/Lying-close-grip-triceps-press-to-chin-1.png', 'https://wger.de/media/exercise-images/84/Lying-close-grip-triceps-press-to-chin-2.png'],},
	{id: 846, images: ['https://wger.de/media/exercise-images/1604/7695428e-bfed-4021-b987-498d93153995.png'],},
	{id: 850, images: ['https://wger.de/media/exercise-images/1593/9815fcd6-cf40-4ddd-9b38-2eac25973de1.gif'],},
	{id: 851, images: ['https://wger.de/media/exercise-images/1594/e030d44e-d023-4fef-a3bd-934d70f65d96.gif'],},
	{id: 864, images: ['https://wger.de/media/exercise-images/1339/fcfef836-03eb-431f-8ebc-7200479edcdb.webp'],},
	{id: 869, images: ['https://wger.de/media/exercise-images/1232/2b6de046-5806-49e3-bf36-b6fae16af021.png'],},
	{id: 870, images: ['https://wger.de/media/exercise-images/1233/d7d6f9e1-7834-4cca-bd3b-f9def33ff44d.png'],},
	{id: 871, images: ['https://wger.de/media/exercise-images/1344/61ea201e-533d-422f-a1b8-58bd480f2419.webp'],},
	{id: 872, images: ['https://wger.de/media/exercise-images/622/9a429bd0-afd3-4ad0-8043-e9beec901c81.jpeg', 'https://wger.de/media/exercise-images/622/d6d57067-97de-462e-a8bb-15228d730323.jpeg', 'https://wger.de/media/exercise-images/622/0705bc22-fadd-4c19-9c94-649a0b1f927f.jpeg'],},
	{id: 873, images: ['https://wger.de/media/exercise-images/1239/5026373a-a7b4-4e26-a0aa-c46634205196.jpg'],},
	{id: 889, images: ['https://wger.de/media/exercise-images/1346/47edbf50-1195-4450-9321-7152ec1173c9.webp'],},
	{id: 893, images: ['https://wger.de/media/exercise-images/927/7b392101-9c47-4693-935e-a88b1887eec5.jpg'],},
	{id: 896, images: ['https://wger.de/media/exercise-images/1285/1ab8005d-41e4-4505-9a7d-5277d59bb3cd.jpg'],},
	{id: 904, images: ['https://wger.de/media/exercise-images/1377/12e7a231-d36a-4992-bf57-ff7bfe0f3ae4.jpg'],},
	{id: 906, images: ['https://wger.de/media/exercise-images/1581/b71a6710-5798-4639-ac5a-22a2cdae2036.jpg'],},
	{id: 909, images: ['https://wger.de/media/exercise-images/1615/7792295c-83b6-4ea8-9353-ce02f0ad2559.jpg'],},
	{id: 914, images: ['https://wger.de/media/exercise-images/659/a60452f1-e2ea-43fe-baa6-c1a2208d060c.png'],},
	{id: 917, images: ['https://wger.de/media/exercise-images/1336/ebf88217-df26-4ef7-94cb-f0c2220c6abe.webp'],},
	{id: 918, images: ['https://wger.de/media/exercise-images/1185/c5ca283d-8958-4fd8-9d59-a3f52a3ac66b.jpg'],},
	{id: 919, images: ['https://wger.de/media/exercise-images/1230/9fd1e2fd-f2c4-432d-b3ae-5e5f24085777.webp'],},
	{id: 920, images: ['https://wger.de/media/exercise-images/1231/b10457ce-5fa5-4d20-a32f-3c7100c6a9d9.webp'],},
	{id: 927, images: ['https://wger.de/media/exercise-images/959/53a5e008-bc31-4ee0-9463-69a858c2ec18.png'],},
	{id: 935, images: ['https://wger.de/media/exercise-images/694/119e6823-6960-4341-a9e1-aaf78d7fb57c.png', 'https://wger.de/media/exercise-images/694/2e69c005-b241-4806-8557-fc5a4d5ee44d.png'],},
	{id: 936, images: ['https://wger.de/media/exercise-images/691/297d4ce1-7e9e-4adb-8f5c-7d54054be885.jpg', 'https://wger.de/media/exercise-images/691/72bb8231-8994-453f-8a3f-85b061dcffb8.jpg', 'https://wger.de/media/exercise-images/691/141711a2-58dc-47f7-b30c-968256953198.jpg'],},
	{id: 944, images: ['https://wger.de/media/exercise-images/1100/ab203e0c-8220-4537-987c-871eb259d687.jpg'],},
];
const OUT_ROOT = path.join(__dirname, "downloads");
const CONCURRENCY = 8; // tweak if you want faster/slower
const MAX_RETRIES = 3;

function ensureDirSync(p) {
  fs.mkdirSync(p, { recursive: true });
}

function isNoFile(url) {
  return /\/nofile\.gif$/i.test(url);
}

async function fetchWithRetry(url, init = {}, tries = MAX_RETRIES) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, init);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return res;
    } catch (err) {
      lastErr = err;
      console.warn(`Retry ${i}/${tries} for ${url} -> ${err}`);
      if (i < tries) await new Promise(r => setTimeout(r, 600 * i));
    }
  }
  throw lastErr;
}

async function downloadVideo(url, outFile) {
  const res = await fetchWithRetry(url);
  await pipeline(res.body, fs.createWriteStream(outFile));
}

async function downloadImageAsPng(url, outFilePng) {
  const res = await fetchWithRetry(url);
  const buf = Buffer.from(await res.arrayBuffer());
  // Convert any source (jpg/gif/webp/etc.) to PNG. For animated GIFs, this saves the first frame.
  await sharp(buf, { animated: false }).png().toFile(outFilePng);
}

function taskQueue(concurrency) {
  let running = 0;
  const queue = [];
  const runNext = () => {
    if (running >= concurrency || queue.length === 0) return;
    const { fn, resolve, reject } = queue.shift();
    running++;
    fn()
      .then((v) => { running--; resolve(v); runNext(); })
      .catch((e) => { running--; reject(e); runNext(); });
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    runNext();
  });
}

async function main() {
  console.log(`Starting download of ${downloadAssets.length} items...`);
  ensureDirSync(OUT_ROOT);

  const enqueue = taskQueue(CONCURRENCY);
  let scheduled = 0;

  for (const item of downloadAssets) {
    const baseDir = path.join(OUT_ROOT, String(item.id), "container");
    ensureDirSync(baseDir);

    // IMAGES -> png
    for (let i = 0; i < (item.images?.length || 0); i++) {
      const imgUrl = item.images[i];
      if (!imgUrl || isNoFile(imgUrl)) {
        console.warn(`[id ${item.id}] Skipping missing image at index ${i + 1}`);
        continue;
      }
      const out = path.join(baseDir, `img-${i + 1}.png`);
      scheduled++;
      enqueue(async () => {
        try {
          await downloadImageAsPng(imgUrl, out);
          console.log(`[OK] ${out}`);
        } catch (e) {
          console.error(`[FAIL img] [id ${item.id}] #${i + 1} ${imgUrl}\n  -> ${e}`);
        }
      });
    }

    // VIDEOS -> mp4 (keep original mp4)
    for (let i = 0; i < (item.videos?.length || 0); i++) {
      const vidUrl = item.videos[i];
      if (!vidUrl) {
        console.warn(`[id ${item.id}] Skipping empty video at index ${i + 1}`);
        continue;
      }
      const out = path.join(baseDir, `vid-${i + 1}.mp4`);
      scheduled++;
      enqueue(async () => {
        try {
          await downloadVideo(vidUrl, out);
          console.log(`[OK] ${out}`);
        } catch (e) {
          console.error(`[FAIL vid] [id ${item.id}] #${i + 1} ${vidUrl}\n  -> ${e}`);
        }
      });
    }
  }

  // Wait for all queued tasks to complete
  // A tiny trick: enqueue N no-op tasks, then wait for them to run after the queue drains.
  // Or better: poll until queue empties and no tasks running — but our queue is encapsulated.
  // Simpler: create a barrier by scheduling and awaiting an empty batch:
  if (scheduled === 0) {
    console.log("Nothing to download.");
    return;
  }

  // Create a small sentinel to wait until the queue is empty:
  await enqueue(async () => {});
  console.log("All done ✅");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
