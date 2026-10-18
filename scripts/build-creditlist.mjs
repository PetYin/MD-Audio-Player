import fs from 'node:fs';

// The in-app list and distributed document share one reviewed set of credits.
const credits = JSON.parse(fs.readFileSync(new URL('../shared/credits.json', import.meta.url), 'utf8'));
const cell = value => value.replaceAll('|', '\\|').replaceAll('\n', ' ');
// These paths exist only in portable builds, so keep them as path references
// rather than broken links in the source repository and source ZIP.
const portableOnlyDocuments = new Set(['resources/vendor/licenses/', 'LICENSES.chromium.html']);
const sections = credits.sections.map(section => [
  `## ${section.title}`, section.note,
  [
    '| 组件 | 版本 | 许可 | 用途 |', '| --- | --- | --- | --- |',
    ...section.entries.map(entry => `| ${[entry.name, entry.version, entry.license, entry.purpose].map(cell).join(' | ')} |`),
  ].join('\n'),
].join('\n\n'));
const document = [
  '# Creditlist · 第三方软件与致谢',
  '<!-- Generated from shared/credits.json by scripts/build-creditlist.mjs. -->',
  credits.intro,
  `## ${credits.rights.title}`,
  ...credits.rights.paragraphs,
  credits.rights.attribution.join('  \n'),
  ...sections,
  '## 完整许可与源码说明',
  '播放器内可通过「设置与偏好 → 关于 → Creditlist · 第三方软件与致谢」离线查看此清单。便携包中的文件位置如下；源码工程的第三方许可文本位于 `vendor/licenses/`。',
  credits.documents.map(item => {
    const reference = portableOnlyDocuments.has(item.path) ? `\`${item.path}\`` : `[${item.path}](${item.path})`;
    return `- ${reference}：${item.description}`;
  }).join('\n'),
  credits.closing,
].join('\n\n') + '\n';
fs.writeFileSync(new URL('../CREDITLIST.md', import.meta.url), document, 'utf8');
