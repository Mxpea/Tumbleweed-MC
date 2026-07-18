import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import yazl from 'yazl';
import { renderDeployScripts } from '../deploy/render.ts';
import type { ResolveOutcome, TumbleweedJson } from '../types.ts';

/** 在 UTF-8 字符串前加 BOM，让 Windows PowerShell 5.1 正确识别编码 */
function utf8Bom(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
}

export interface PackInput {
  root: string;
  outZip: string;
  json: TumbleweedJson;
  outcomes: ResolveOutcome[];
  regularFiles: string[];
}

/**
 * 把 Tumbleweed.json + overrides + deploy 脚本打包到 zip。
 * - Tumbleweed.json 不向 jar 收集 sha512（已由 resolve 阶段填好）
 * - overrides/* 包含所有 regularFiles（非 jar）以及 source=embedded 的 jar
 * - deploy.sh/.bat/.ps1 三脚本由 deploy/render 渲染并写入
 */
export async function packZip(input: PackInput): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = createWriteStream(input.outZip);
    const zip = new yazl.ZipFile();
    zip.outputStream.pipe(out);
    out.on('error', reject);
    out.on('finish', () => resolve());

    // 1. Tumbleweed.json
    const jsonText = JSON.stringify(input.json, null, 2);
    zip.addBuffer(Buffer.from(jsonText, 'utf8'), 'Tumbleweed.json');

    // 2. regularFiles -> overrides/<path>
    const tasks: Promise<void>[] = [];
    for (const rel of input.regularFiles) {
      const abs = join(input.root, rel);
      tasks.push(readFile(abs).then((buf) => zip.addBuffer(buf, `overrides/${rel}`)));
    }
    // 3. embedded jars -> overrides/<path>
    for (const o of input.outcomes) {
      if (o.entry.source === 'embedded') {
        const abs = join(input.root, o.entry.path);
        tasks.push(readFile(abs).then((buf) => zip.addBuffer(buf, `overrides/${o.entry.path}`)));
      }
    }

    Promise.all(tasks)
      .then(() => {
        // 4. deploy 脚本
        // UTF-8 BOM 让 Windows PowerShell 5.1 正确按 UTF-8 解析含中文的脚本
        const scripts = renderDeployScripts(input.json);
        zip.addBuffer(Buffer.from(scripts.sh, 'utf8'), 'deploy.sh');
        zip.addBuffer(utf8Bom(scripts.ps1), 'deploy.ps1');
        // .bat 走 cmd.exe，cmd 不认 UTF-8 BOM，必须保持 ANSI 兼容；
        // 批处理的功能性命令都是 ASCII，少量中文注释会被显示成乱码但不影响运行。
        zip.addBuffer(Buffer.from(scripts.bat, 'utf8'), 'deploy.bat');
        zip.end();
      })
      .catch(reject);
  });
}
