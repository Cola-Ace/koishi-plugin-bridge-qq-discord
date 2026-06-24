import { Bot, Context, h } from "koishi";
import type { Session } from "koishi";
import { getBinary, logger, BlacklistDetector, toDataUrl } from "../utils";
import { Config, BasicType } from "../config";

import { URL } from "url";

// return stop = false 相当于 break

export default class ProcessorDiscord {
	static async process(
		elements: h[],
		config: Config,
		[from, to]: [BasicType, BasicType],
		ctx: Context,
		message: string,
		message_data: Session["event"]["message"],
		dc_bot: Bot,
		qqbot: Bot,
		Blacklist: BlacklistDetector
	): Promise<string> {
		for (const element of elements.length === 0 ? message_data.quote.elements : elements) {
			switch (element.type) {
				case "text": {
					if (Blacklist.check(element.attrs.content)) return ""; // 黑名单检测

					message += element.attrs.content;

					break;
				}

				case "at": {
					// https://github.com/Cola-Ace/koishi-plugin-bridge-discord-qq/issues/4
					if (element.attrs.type === "all") {
						message += "@everyone ";
						break;
					}

					// https://github.com/Cola-Ace/koishi-plugin-bridge-discord-qq/issues/5
					if (element.attrs.type === "here") {
						message += "@here ";
						break;
					}

					const user_info = await dc_bot.internal.getUser(element.attrs.id);
					message += `@${user_info["global_name"] === null ? element.attrs.name : user_info["global_name"]}`;

					break;
				}

				case "https:": {
					message += `https:${Object.keys(element.attrs).join("=")}`;

					break;
				}

				case "img": {
					if (config.file_processor === "Koishi") {
						const [img_blob, img_type, img_error] = await getBinary(element.attrs.src, ctx.http);
						if (img_error) {
							logger.error(img_error);
							break;
						}
						const img_arrayBuffer = await img_blob.arrayBuffer();
						message += h.image(toDataUrl(img_arrayBuffer, img_type));
					} else {
						message += h.image(element.attrs.src);
					}

					break;
				}

				case "face": {
					const src = element.children[0].attrs.src;
          const url = `${src}${src.indexOf("?quality=lossless") !== -1 ? "&size=44" : ""}`

          if (config.file_processor === "Koishi") {
						const [img_blob, img_type, img_error] = await getBinary(url, ctx.http);
						if (img_error) {
							logger.error(img_error);
							break;
						}
						const img_arrayBuffer = await img_blob.arrayBuffer();
						message += h.image(toDataUrl(img_arrayBuffer, img_type));
					} else {
						message += h.image(url);
					}

					break;
				}

				case "record":
				case "file": {
					if (parseInt(element.attrs.size) > config.qq_file_limit) {
						message += "【检测到大小超过设置上限的文件，请到 Discord 查看】";
						break;
					}
					const path = await qqbot.internal.downloadFile(element.attrs.src);

					await qqbot.internal.uploadGroupFile(to.channel_id, path, element.attrs.file);

					break;
				}

				case "video": {
					if (parseInt(element.attrs.size) > config.qq_file_limit) {
						message += "【检测到大小超过设置上限的视频，请到 Discord 查看】";
						break;
					}

					try {
						const urlHost = new URL(element.attrs.src).host;
						const allowedHosts = ["youtube.com", "www.youtube.com"];
						if (allowedHosts.includes(urlHost)) break;
					} catch (error) {
						logger.error(`Invalid URL: ${element.attrs.src}`);
						break;
					}

					if (config.file_processor === "Koishi") {
						const [video_blob, video_type, video_error] = await getBinary(element.attrs.src, ctx.http);
						if (video_error) {
							logger.error(video_error);
							break;
						}
						const video_arrayBuffer = await video_blob.arrayBuffer();
						message += h.video(toDataUrl(video_arrayBuffer, video_type));
					} else {
						message += h.video(element.attrs.src);
					}

					break;
				}

				default: {
					break;
				}
			}
		}

		return message;
	}
}
