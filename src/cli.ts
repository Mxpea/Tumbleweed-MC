#!/usr/bin/env node
import { Command } from 'commander';
import { packCommand } from './commands/pack.ts';

const program = new Command();

program
  .name('tumbleweed')
  .description('Minecraft 服务端打包工具：输出可重分发 zip + deploy 脚本')
  .version('0.1.0');

program
  .command('pack')
  .description('打包服务器目录')
  .argument('[root]', '服务器根目录', undefined)
  .option('-o, --out <path>', '输出 zip 路径')
  .option(
    '-l, --loader <type>',
    '强制 loader 类型 (neoforge|forge|fabric|quilt|paper|purpur|leaf|vanilla)',
  )
  .option('--mc-version <ver>', '强制 MC 版本')
  .option('--full', '全量打包模式')
  .option('--skip-tui', '跳过 TUI，使用 flag 与环境变量')
  .action(
    async (
      root: string | undefined,
      opts: {
        out?: string;
        loader?: string;
        mcVersion?: string;
        full?: boolean;
        skipTui?: boolean;
      },
    ) => {
      try {
        await packCommand({
          root,
          out: opts.out,
          loader: opts.loader,
          mcVersion: opts.mcVersion,
          full: opts.full,
          noTui: opts.skipTui,
        });
      } catch (e) {
        console.error(`\x1b[31m✗ ${e instanceof Error ? e.message : String(e)}\x1b[0m`);
        process.exit(1);
      }
    },
  );

program.parseAsync(process.argv).catch((e) => {
  console.error(e);
  process.exit(1);
});
