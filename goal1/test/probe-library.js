// 临时探查：下载 2 个 library.json，打印结构概览
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LIBS = [
    { id: 'main', url: 'https://res.3dtank.com/553/105167/27/302/30546776460526/library.json' },
    { id: 'newyear', url: 'https://res.3dtank.com/570/174542/371/71/31167243462337/library.json' },
];

for (const lib of LIBS) {
    console.log('\n==========', lib.id, '==========');
    console.log('下载:', lib.url);
    const res = await fetch(lib.url);
    console.log('HTTP', res.status, res.statusText);
    if (!res.ok) continue;
    const json = await res.json();
    writeFileSync(join('data', 'cache', `${lib.id}_library.json`), JSON.stringify(json));
    console.log('顶层键:', Object.keys(json));
    console.log('name:', json.name);
    console.log('groups 数量:', json.groups?.length);
    let total = 0;
    const groupNames = [];
    for (const g of (json.groups || [])) {
        total += g.props?.length || 0;
        groupNames.push(`${g.name}(${g.props?.length || 0})`);
    }
    console.log('总 props 数:', total);
    console.log('groups:', groupNames.join(', '));
    // prop 结构样本
    const g0 = json.groups?.[0];
    if (g0?.props?.length) {
        console.log('prop[0] 键:', Object.keys(g0.props[0]));
        console.log('prop[0]:', JSON.stringify(g0.props[0]).slice(0, 400));
        // 名称前缀分布（用于推断分类）
        const prefixes = {};
        for (const p of g0.props) {
            const pre = (p.name || '').split('_')[0];
            prefixes[pre] = (prefixes[pre] || 0) + 1;
        }
        const sorted = Object.entries(prefixes).sort((a, b) => b[1] - a[1]);
        console.log('名称前缀 Top 15:', sorted.slice(0, 15).map(([k, v]) => `${k}=${v}`).join(', '));
    }
}
