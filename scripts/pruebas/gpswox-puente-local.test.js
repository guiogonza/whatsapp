// Prueba del puente local (lib/session/gpswox-puente-local.js): llama a los flujos reales con los argumentos correctos.
const Module = require('module');
const base = process.argv[2];
const llamadas = [];
let sesion = { socket: { id: 'sock' }, state: 'READY' };
const orig = Module._load;
Module._load = function (r, ...a) {
  if (/\/index$/.test(r)) return { getSession: n => (n === 'gpswox-session' ? sesion : null) };
  if (/inspeccion-flow$/.test(r)) return { handleMessage: async (...x) => { llamadas.push(['insp', x[1], x[2], x[3], x[4], x[5] && x[5].id]); } };
  if (/preop-flow$/.test(r)) return {
    handleMessage: async (...x) => { llamadas.push(['preop', x[1], x[2], x[3]]); },
    iniciarJornada: async (...x) => { llamadas.push(['jornada-inicio', x[1]]); },
    iniciarFinJornada: async (...x) => { llamadas.push(['jornada-fin', x[1]]); },
  };
  if (/empresa-pref$/.test(r)) return { guardar: async (j, e) => { llamadas.push(['empresa', j, e]); } };
  if (/(^|\/)config$/.test(r)) return { GPSWOX_SESSION_NAME: 'gpswox-session', SESSION_STATES: { READY: 'READY' } };
  return orig.call(this, r, ...a);
};
const p = require(base + 'lib/session/gpswox-puente-local.js');
let fallas = 0; const ok = (n, c, x = '') => { if (!c) fallas++; console.log((c ? 'OK    ' : 'FALLA ') + n + (x ? '  | ' + x : '')); };
const esp = () => new Promise(r => setTimeout(r, 10));
(async () => {
  let r = await p.startInspection('573001112233@s.whatsapp.net');
  ok('inspeccion: arranca el flujo con la sesion real y la palabra INSPECCION', r.success && JSON.stringify(llamadas[0]) === JSON.stringify(['insp', 'gpswox-session', '573001112233@s.whatsapp.net', 'INSPECCION', null, 'sock']), JSON.stringify(llamadas[0]));
  llamadas.length = 0;
  r = await p.startInspection('573001112233');
  ok('un telefono sin @ se convierte en jid', r.success && llamadas[0][2] === '573001112233@s.whatsapp.net');
  llamadas.length = 0;
  r = await p.startPreopRastrear('573001112233@s.whatsapp.net'); await esp();
  ok('preop de Rastrear: guarda la empresa y arranca con PREOPR', r.success && llamadas.some(l => l[0] === 'empresa' && l[2] === 'rastrear') && llamadas.some(l => l[0] === 'preop' && l[3] === 'PREOPR'), JSON.stringify(llamadas));
  llamadas.length = 0;
  r = await p.startJornadaCointra('573001112233@s.whatsapp.net', 'inicio'); await esp();
  ok('Cointra inicio: iniciarJornada', r.success && llamadas.some(l => l[0] === 'jornada-inicio') && llamadas.some(l => l[0] === 'empresa' && l[2] === 'cointra'), JSON.stringify(llamadas));
  llamadas.length = 0;
  r = await p.startJornadaCointra('573001112233@s.whatsapp.net', 'fin');
  ok('Cointra fin: iniciarFinJornada', r.success && llamadas.some(l => l[0] === 'jornada-fin'));
  llamadas.length = 0;
  sesion = null; r = await p.startInspection('573001112233');
  ok('sin sesion conectada devuelve error y no arranca nada', !r.success && /no disponible/.test(r.error) && llamadas.length === 0, r.error);
  sesion = { socket: { id: 's' }, state: 'CLOSED' }; r = await p.startJornadaCointra('573001112233', 'inicio');
  ok('sesion no READY tambien devuelve error', !r.success);
  sesion = { socket: { id: 's' }, state: 'READY' };
  const orig2 = Module._load;
  Module._load = function (rr, ...a) { if (/inspeccion-flow$/.test(rr)) return { handleMessage: async () => { throw new Error('boom'); } }; return orig2.call(this, rr, ...a); };
  r = await p.startInspection('573001112233');
  ok('si el flujo falla devuelve el error sin lanzar', !r.success && r.error === 'boom');
  console.log(fallas ? fallas + ' FALLAS' : 'TODO OK'); process.exit(fallas ? 1 : 0);
})().catch(e => { console.log('ERR', String(e.stack).slice(0, 300)); process.exit(1); });
