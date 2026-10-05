const colors=['#3978f6','#8c79ee','#58c5bd'];
const svg=(label,content)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 180" role="img" aria-label="${label}" style="display:block;width:100%;height:auto;overflow:visible">${content}</svg>`;
const grid=[20,60,100,140].map((y,i)=>`<line x1="32" y1="${y}" x2="290" y2="${y}" stroke="#e8edf5" stroke-dasharray="3 4"/><text x="24" y="${y+4}" text-anchor="end" fill="#8a96a8" font-size="10">${120-i*40}</text>`).join('');
const months=['1月','2月','3月','4月','5月','6月'];
const axis=months.map((label,i)=>`<text x="${52+i*43}" y="165" text-anchor="middle" fill="#8a96a8" font-size="10">${label}</text>`).join('');
const wrap=(type,title,subtitle,content,footer)=>`<div data-chart-type="${type}" style="padding:20px;background:#fff;border:1px solid #e3e9f2;border-radius:14px;color:#24334c;font-family:system-ui,sans-serif;box-shadow:0 3px 12px #182b4a06;overflow:hidden"><p style="margin:0 0 4px;font-size:15px;font-weight:600;line-height:1.5;color:#24334c">${title}</p><p style="margin:0 0 18px;font-size:11px;line-height:1.5;color:#8794a7">${subtitle} · 演示数据</p>${content}<div style="display:flex;justify-content:center;flex-wrap:wrap;gap:14px;margin-top:12px;font-size:11px;line-height:1.5;color:#76849a">${footer}</div></div>`;
const legend=(label,color)=>`<span style="display:inline-flex;align-items:center;gap:6px"><span style="display:inline-block;width:8px;height:8px;border-radius:3px;background:${color}"></span>${label}</span>`;
const values=[48,76,60,96,84,112];
const bars=values.map((value,i)=>`<rect x="${40+i*43}" y="${140-value}" width="24" height="${value}" rx="4" fill="${i===5?'#3978f6':'#a9c6fc'}"/>`).join('');
const points=values.map((value,i)=>`${52+i*43},${140-value}`).join(' ');
const line= `<polygon points="52,140 ${points} 267,140" fill="#eff5ff"/><polyline points="${points}" fill="none" stroke="#3978f6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`+values.map((value,i)=>`<circle cx="${52+i*43}" cy="${140-value}" r="4" fill="#fff" stroke="#3978f6" stroke-width="2"/>`).join('');
const ring=`<div style="position:relative;width:180px;height:180px;margin:0 auto"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" role="img" aria-label="圆环占比图：渠道 A 60%，渠道 B 25%，渠道 C 15%" style="display:block;width:100%;height:100%;transform:rotate(-90deg)"><circle cx="90" cy="90" r="65" fill="none" stroke="#f0f3f8" stroke-width="22"/>${[60,25,15].map((value,i)=>`<circle cx="90" cy="90" r="65" pathLength="100" fill="none" stroke="${colors[i]}" stroke-width="22" stroke-dasharray="${value} ${100-value}" stroke-dashoffset="${-[0,60,85][i]}"/>`).join('')}</svg><div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none"><strong style="font-size:28px;line-height:1.3;color:#24334c">60%</strong><span style="margin-top:4px;font-size:11px;color:#8794a7">主要渠道</span></div></div>`;
export const chartTemplates={
  bar:wrap('bar','月度业绩','近六个月',svg('柱状图：近六个月业绩',grid+bars+axis),legend('业绩','#3978f6')),
  line:wrap('line','增长趋势','近六个月',svg('折线图：近六个月增长趋势',grid+line+axis),legend('增长趋势','#3978f6')),
  donut:wrap('donut','渠道占比','来源分布',ring,['渠道 A 60%','渠道 B 25%','渠道 C 15%'].map((label,i)=>legend(label,colors[i])).join('')),
};
