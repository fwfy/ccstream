const connector = require("@fwfy/connector");
const { program } = require('commander');
const download = require('download');
const fs = require('fs');
let downloading = false;

program
	.name("mgctl")
	.description("MediaGet CLI")
	.version("0.0.1");

setInterval(_=>{},1000);

program.command('list-profiles')
	.description("Fetch a list of all available media profiles from the server.")
	.action(_ => {
		console.log("initializing connector...");
		connector.connect({
			server: "wss://api.fwfy.club/connector",
			id: "mgctl"
		});
		connector.on("init", _ => {
			console.log("connected! querying MediaGet...");
			connector.send(null,"mediaget_list_profiles");
		});
		connector.on("mediaget_profiles", e => {
			console.log(`Available Profiles:\n\n${e.msg}`);
			process.exit(0);
		});
	});

program.command('dl')
	.description("Downloads a media resource using the MediaGet API")
	.argument('<string>', 'The URL of the media')
	.option('-p, --profile <string>')
	.option('-o, --output <string>')
	.action((url, options) => {
		console.log("initializing connector...");

		connector.connect({
		        server: "wss://api.fwfy.club/connector",
		        id: "mgctl"
		});

		let id = Math.random().toString().substr(-6);
		connector.on("init", _ => {
			console.log("connected! sending MediaGet request...");
		        connector.send({
		                profile: options.profile,
		                url: url,
				ctid: true,
				id: id
			},"mediaget_fetch");
			console.log("sent request to MediaGet!");
		});
		connector.on(`mediaget_ready_${id}`, async e => {
			if(downloading) return console.log("ignoring duplicate reply");
			downloading = true;
			console.log("media is ready for download!");
			let data = JSON.parse(e.msg);
			console.log(data);
			download(data.url,`./`).then(_ => {
				console.log(`saved as ${data.minfo.title}.${data.url.split(".").slice(-1)} :3`);
				fs.renameSync(`${data.url.split("/").slice(-1)}`,options.output?options.output:`${data.minfo.title}.${data.url.split(".").slice(-1)}`);
				process.exit(0);
			});
		});
		connector.on(`mediaget_fail_${id}`, e => {
			let data = JSON.parse(e.msg);
			console.error(`request failed!\n\nMediaGet says: ${data.reason}: ${data.human_reason}.`);
			process.exit(1);
		});
	});

program.parse();
