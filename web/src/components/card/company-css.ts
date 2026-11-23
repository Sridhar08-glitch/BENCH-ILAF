// The few styles a company card needs on top of the design library: the logo laid on a face, the logo above the card,
// the background and pattern layers, and the template zones. Scoped under `.cfl` like the library itself, and only
// sent with pages that draw a company card.
export const COMPANY_CSS = `
.cfl .colg{box-sizing:border-box;position:absolute;z-index:40;pointer-events:none;display:flex;align-items:center;justify-content:center;transition:none}
.cfl .colg[hidden]{display:none}
.cfl .colg img{display:block;width:100%;height:100%;object-fit:contain}
.cfl .colg.chip{border-radius:1.6cqw;box-shadow:0 .5cqw 1.6cqw rgba(0,0,0,.22),0 0 0 .12cqw rgba(0,0,0,.1)}
.cfl .colg.w img{filter:brightness(0) invert(1)}
.cfl .colg.k img{filter:brightness(0)}
.cfl .colg.lk{overflow:hidden}
.cfl .colg .cn{display:block;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;font-weight:800;line-height:1.1;letter-spacing:.005em;text-align:left}
.cfl .colg.lk img{flex:none;width:auto;height:100%}
.cfl .cohead{display:flex;align-items:center;justify-content:center;gap:10px;min-height:34px}
.cfl .cohead[hidden]{display:none}
.cfl .cohead .lgw{display:inline-flex;align-items:center;border-radius:10px;padding:5px 8px;max-width:100%}
.cfl .cohead .lgw .cn{flex:none;overflow:visible}
.cfl .cohead .lgw img{display:block}
.cfl .face.back .bk2{max-width:80%;text-align:center}
.cfl.co .face.back{padding-top:9cqw}
.cfl.co .face.back .qrt{width:25cqw;height:25cqw;padding:1.4cqw}
.cfl.co{position:relative}
.cfl .face.cobg,.cfl .face.back.cobg{background:linear-gradient(var(--cosc),var(--cosc)),var(--cobgimg) center/cover no-repeat,var(--cbg)}
.cfl .coband{position:absolute;left:0;right:0;bottom:0;height:3cqw;z-index:3;pointer-events:none;background:linear-gradient(var(--coscb),var(--coscb)),var(--cobgimg) center/cover no-repeat}
.cfl.cobgp{background:linear-gradient(var(--cosc2),var(--cosc2)),var(--cobgimg) center/cover no-repeat,var(--pgbg)}
.cfl .copatw{position:absolute;inset:0;overflow:hidden;z-index:30;pointer-events:none}
.cfl .copat{position:absolute;inset:-60%;transform:rotate(var(--copang,0deg));background-image:var(--copat);background-size:var(--copw) auto;background-repeat:repeat;opacity:var(--copop,.12);filter:var(--copf,none)}
.cfl .face.back .copatw{z-index:1}
.cfl .face.back>.qrt,.cfl .face.back>.bk1,.cfl .face.back>.bk2{position:relative;z-index:2}
.cfl .copatw.pgp{z-index:0}
.cfl.copg>.pg{position:relative;z-index:1}
.cfl .face.tpf{background-color:#222;background-size:cover;background-position:center;background-repeat:no-repeat;color:var(--tpfg)}
.cfl .face.tpb{background-color:#222;background-size:cover;background-position:center;background-repeat:no-repeat}
.cfl .tpf .tzt{position:absolute;display:flex;flex-direction:column;gap:1cqw;z-index:5}
.cfl .tpf .tzt .n{font-size:calc(6.2cqw*var(--tsz,1));font-weight:800;line-height:1.08;letter-spacing:-.01em;color:var(--tpfg)}
.cfl .tpf .tzt .t1{font-size:calc(2.7cqw*var(--tsz,1));text-transform:none;letter-spacing:.03em;color:var(--tpfg);font-weight:700;opacity:.95;line-height:1.25}
.cfl .tpf .tzc{position:absolute;display:flex;flex-direction:column;gap:.9cqw;z-index:5;font-size:calc(2.5cqw*var(--tsz,1))}
.cfl .tpf .tzc .ln{display:flex;gap:1cqw;align-items:center;color:var(--tpfg);font-weight:600;max-width:100%}
.cfl .tpf .tzc .ln b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.cfl .tpf .tzc .ln .ico{flex:none;stroke:currentColor;width:1.25em;height:1.25em}
.cfl .tpf .pn{border-radius:1.6cqw;padding:1.6cqw 2cqw}
.cfl .tpf .pn.pd{background:rgba(11,13,18,.74)}
.cfl .tpf .pn.pl{background:rgba(255,255,255,.74)}
.cfl .tzband{position:absolute;left:0;right:0;bottom:0;z-index:2}
.cfl .tzp{position:absolute;z-index:6;border-radius:50%;overflow:hidden;background:var(--cacc);color:var(--con);box-shadow:0 0 0 .8cqw rgba(255,255,255,.92),0 .6cqw 1.8cqw rgba(0,0,0,.3)}
.cfl .tzp .pic{width:100%;height:100%;object-fit:cover;display:grid;place-items:center;font-weight:800;font-size:7cqw}
.cfl .tzq{position:absolute;z-index:6;background:#fff;padding:1cqw;border-radius:1.4cqw;box-shadow:0 .4cqw 1.4cqw rgba(0,0,0,.25)}
.cfl .tzq svg{display:block;width:100%;height:100%}
.cfl .tpb .bk1{font-weight:700}
.cfl.mea{position:fixed;left:0;top:0;opacity:0;z-index:-1;pointer-events:auto;overflow:hidden;background:none}
`.trim();
