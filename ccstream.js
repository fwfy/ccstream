const fsPromises = require("fs/promises");
const path = require("node:path");
const WebSocket = require("ws");
const crypto = require("crypto");
const util = require('util');
const exec = util.promisify(require("child_process").exec);

const WS_OPTS = {
	port: 4040
}

let HTTP_MODE = false;
let http_server;

if (process.env.RUN_HTTP_SERVER == 1) {
	HTTP_MODE = true;
	const http = require("node:http");
	http_server = http.createServer(async function (req, res) {
		res.write(await fsPromises.readFile("./client.lua"));
		res.end();
	}).listen(4040);
}

const wss = new WebSocket.Server(HTTP_MODE ? { server: http_server } : WS_OPTS);

const CHUNK_SIZE = 16384;
const SONG_FOLDER = "./music";

let songs = {};

async function scanFolder() {
	if(process.env.CLEAR_YT == 1) {
		await exec(`rm ${SONG_FOLDER}/*.dfpwm`);
	}
	let files = await fsPromises.readdir(SONG_FOLDER);
	for(const file of files) {
		let basename = file.split(".")[0];
		let split = basename.split("_");
		let title = basename;
		if(split[1] == "L" && files.includes(`${split[0]}_R.dfpwm`)) {
			title = split[0];
			console.log(`Found stereo pair: ${title}`);
			songs[title] = {
				stereo: true,
				file_L: path.join(SONG_FOLDER, file),
				file_R: path.join(SONG_FOLDER, `${title}_R.dfpwm`)
			}
		} else if(!songs[title] && !songs[split[0]]?.stereo) {
			console.log(`Adding song ${title}`);
			songs[title] = {
				file: path.join(SONG_FOLDER, file),
				stereo: false
			}
		}
	}
}

wss.on("connection", (ws) => {
	console.log("New connection!");
	ws.sendJSON = (msg) => ws.send(JSON.stringify(msg));
	ws.on("message", (msg) => parseMessage(msg.toString(), ws));
	ws.sendJSON({
		intent: "hello",
	});
});

async function parseMessage(msg, ws) {
	let o;
	try {
		o = JSON.parse(msg);
	} catch (err) {
		return console.log("Failed to decode JSON:", msg);
	}
	switch (o.intent) {
		case "beginSession":
			if (o.song == "list") {
				ws.sendJSON({
					error: false,
					intent: "status",
					status: Object.keys(songs).join(", "),
				});
				return ws.close();
			}
			if (!o.song || !songs[o.song]) {
				if(o.song.includes("youtu.be") || o.song.includes("youtube.com")) {
					let id = o.song.match(/(?:youtu\.be\/|youtube\.com(?:\/embed\/|\/v\/|\/watch\?v=|\/user\/\S+|\/ytscreeningroom\?v=))([\w\-]{10,12})\b/)[1];
					let url = `https://youtu.be/${id}`;
					o.song = id;
					if(!songs[o.song]) {
						ws.sendJSON({
							error: false,
							intent: "status",
							status: "Starting youtube downloader..."
						})
						await exec(`yt-dlp -t mp3 -o ${id}.mp3 ${url}`); // DANGER DANGER DANGER WARNING FIXME TODO XXX BUG - DO NOT EVER DO THIS
						ws.sendJSON({
							error: false,
							intent: "status",
							status: "Converting from MP3 -> DFPWM..."
						})
						await exec(`ffmpeg -i ${id}.mp3 -ac 1 -c:a dfpwm ${SONG_FOLDER}/${id}.dfpwm -ar 48k`);
						ws.sendJSON({
							error: false,
							intent: "status",
							status: "Download & Conversion finished!"
						})
						songs[o.song] = {
							file: `${SONG_FOLDER}/${id}.dfpwm`,
							stereo: false
						}
					}
				} else {
					ws.sendJSON({
						error: true,
						code: "Invalid song selection.",
					});
					return ws.close();
				}
			}
			if(songs[o.song].stereo && !o.stereo) {
				ws.sendJSON({
					error: true,
					code: "You requested a stereo song, but your client appears to not support stereo audio."
				});
				return ws.close();
			}
			let song = songs[o.song];
			ws.currentSong = song;
			if (!song.stereo) {
				ws.currentSongHandle = await fsPromises.open(song.file, "r");
			} else {
				ws.currentSongHandle_L = await fsPromises.open(song.file_L, "r");
				ws.currentSongHandle_R = await fsPromises.open(song.file_R, "r");
				ws.side = true;
			}
			console.log(`New stream beginning: ${o.song}`);
			ws.sendJSON({
				intent: "status",
				status: "Beginning stream!"
			});
		case "next":
			let chunk = Buffer.allocUnsafe(CHUNK_SIZE);
			let read_result;
			if (!ws.currentSong.stereo) {
				read_result = await ws.currentSongHandle.read(chunk, 0, CHUNK_SIZE);
			} else {
				if (ws.side) {
					read_result = await ws.currentSongHandle_L.read(chunk, 0, CHUNK_SIZE);
				} else {
					read_result = await ws.currentSongHandle_R.read(chunk, 0, CHUNK_SIZE);
				}
				ws.side = !ws.side;
			}
			if (read_result.bytesRead == 0) {
				console.log(`Stream finished.`);
				ws.currentSongHandle.close();
				return ws.close();
			}
			ws.send(chunk.slice(0, read_result.bytesRead));
			break;
	}
}

scanFolder();