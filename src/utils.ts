import { Buffer } from "buffer";
import { Logger, HTTP } from "koishi";
import { MessageBody } from "./types";

export const logger = new Logger("bridge");
export function convertMsTimestampToISO8601(msTimestamp: number): string {
  // 创建一个 Date 对象，传入毫秒级的时间戳
  const date = new Date(msTimestamp);

  // 使用 .toISOString() 方法转换为 ISO 8601 格式
  // 注意：此方法返回的是 UTC 时间
  return date.toISOString();
}

export function generateMessageBody(): MessageBody {
  return {
    text: "",
    form: new FormData(),
    n: 0,
    embed: [],
    validElement: false,
    hasFile: false,
    mentionEveryone: false
  };
}

export function toDataUrl(data: ArrayBuffer | Uint8Array, type?: string | null): string {
  return `data:${type ?? ""};base64,${Buffer.from(data).toString("base64")}`;
}

export function getDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export async function getBinary(url: string, http: HTTP): Promise<[Blob, string, string]> {
  try {
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    }

    // const response = await fetch(url, {
    //   method: "GET",
    //   headers,
    // });

    const response = await http(url, {
      method: "GET",
      headers,
    });
    if (response.status !== 200) {
      throw new Error(`Request Error! URL: ${url} | Status: ${response.status} | Response: ${response.data}`);
    }
    const blob = new Blob([response.data], { type: response.headers.get("Content-Type") });
    return [blob, response.headers.get("Content-Type"), null];
  } catch (error) {
    return [null, null, error];
  }
}

export class BlacklistDetector {
  private blacklist: string[];

  constructor(blacklist: string[]) {
    this.blacklist = blacklist;
  }

  public check(input: string): boolean {
    for (const word of this.blacklist) {
      if (input.toLowerCase().indexOf(word.toLowerCase()) !== -1) return true;
    }
    return false;
  }
}
