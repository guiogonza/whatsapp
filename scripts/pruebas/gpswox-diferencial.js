// Prueba diferencial: ejecuta las MISMAS conversaciones contra un modulo gpswox-session y guarda la transcripcion.
// Uso: node t_diferencial.js <ruta absoluta del gpswox-session.js> <salida.json> [repo raiz para config]
const http = require('http');
const Module = require('module');
const fs = require('fs');
const [, , rutaModulo, salida] = process.argv;

const estado = {
  usuarios: [{ id: 10, email: 'a@x.com', devices_count: 2, active: 1 }, { id: 11, email: 'b@x.com', devices_count: 0, active: 1 }],
  dispositivos: { 1: 'ABC123', 2: 'XYZ987', 3: 'SOL111' },
  asignados: { 1: [1, 3, 10, 11], 2: [1, 3], 3: [10] },
};
const servidor = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); let cuerpo = '';
  req.on('data', d => cuerpo += d);
  req.on('end', () => {
    const j = (o, c = 200) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/api/admin/clients') return j({ current_page: 1, last_page: 1, data: estado.usuarios });
    if (u.pathname === '/api/get_devices') return j([{ id: 5, title: 'Grupo A', items: Object.entries(estado.dispositivos).map(([id, name]) => ({
      id: Number(id), name, lat: 3.45, lng: -76.53, speed: 12, time: '2026-11-26 10:00:00', online: 'online', device_data: { traccar: { latest_positions: '3.45,-76.53' } } })) }]);
    if (u.pathname === '/api/edit_device_data') {
      const sel = {}; (estado.asignados[u.searchParams.get('device_id')] || []).forEach(x => { sel[x] = x; });
      return j({ sel_users: sel });
    }
    if (u.pathname === '/api/edit_device' && req.method === 'POST') {
      const id = u.searchParams.get('device_id'); estado.asignados[id] = JSON.parse(cuerpo).user_id; return j({ status: 1 });
    }
    j({ error: 'ruta no simulada ' + u.pathname }, 404);
  });
});

(async () => {
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  process.env.GPSWOX_API_BASE_PRD = 'http://127.0.0.1:' + servidor.address().port + '/api';
  process.env.GPSWOX_API_HASH_PRD = 'hash-de-prueba';
  delete process.env.GPSWOX_ENV;

  const puentes = [];                       // acciones que el flujo pide a otros bots (inspeccion / preoperacional)
  const proxyVacio = () => new Proxy(function () {}, { get: (_, k) => (k === 'then' ? undefined : proxyVacio()), apply: () => Promise.resolve({}) });
  const puente = {
    startInspection: async t => { puentes.push(['inspeccion']); return { success: true }; },
    startPreopRastrear: async t => { puentes.push(['preop-rastrear']); return { success: true }; },
    startJornadaCointra: async (t, a) => { puentes.push(['jornada-cointra', a]); return { success: true }; },
  };
  const orig = Module._load;
  Module._load = function (r, parent, ...a) {
    if (/database-postgres$/.test(r)) return { logGPSwoxMessage: async () => {}, query: async () => ({ rows: [] }) };
    if (/gpswox-operational$/.test(r)) return { processOperationalMessage: async () => false, startConsultFlow: async () => {}, startMoveSiteFlow: async () => {}, startDocumentExpirationFlow: async () => {} };
    if (/whatsappSender$|gpswox-puente-local$/.test(r)) return puente;
    if (/empresa-pref$/.test(r)) return { EMPRESAS: ['hesego', 'rastrear', 'cointra'], POR_DEFECTO: 'hesego', esEmpresa: e => ['hesego', 'rastrear', 'cointra'].includes(String(e).toLowerCase()), obtener: async () => 'hesego', obtenerOPorDefecto: async () => 'hesego', guardar: async () => {} };
    if (/(^|\/)utils$|odoo-client$/.test(r)) return proxyVacio();
    return orig.call(this, r, parent, ...a);
  };
  const log0 = console.log, err0 = console.error, warn0 = console.warn;
  console.log = console.error = console.warn = () => {};
  const m = require(rutaModulo);
  console.log = log0; console.error = err0; console.warn = warn0;

  const enviados = [];
  const socket = { sendMessage: async (j, c) => { enviados.push(c.text); }, user: {} };
  let n = 0;
  const transcripcion = [];
  const mute = async f => { console.log = console.error = console.warn = () => {}; try { return await f(); } finally { console.log = log0; console.error = err0; console.warn = warn0; } };
  const persona = (nombre) => {
    const T = '5730011' + String(++n).padStart(5, '0') + '@s.whatsapp.net';
    return async txt => {
      enviados.length = 0; puentes.length = 0;
      await mute(() => m.processGPSwoxMessage({}, 'gpswox-session', socket, T, txt, true));
      transcripcion.push({ escenario: nombre, dice: txt, responde: enviados.slice(), puentes: puentes.slice(), asignados: JSON.stringify(estado.asignados) });
    };
  };
  const reset = () => { estado.asignados = { 1: [1, 3, 10, 11], 2: [1, 3], 3: [10] }; };
  const correr = async (nombre, pasos) => { reset(); const dice = persona(nombre); for (const p of pasos) await dice(p); };

  await correr('hesego menu y opciones invalidas', ['hesego', '9', 'abc', '0', 'menu']);
  await correr('hesego consultar placa y ubicacion', ['hesego', '1', 'ABC123', 'ZZZ000', 'XYZ-987', '0']);
  await correr('hesego inspeccion', ['hesego', '2']);
  await correr('hesego asignar completo', ['hesego', '3', 'no-es-correo', 'nadie@x.com', 'b@x.com', 'ZZZ000', 'XYZ987']);
  await correr('hesego asignar ya asignado', ['hesego', '3', 'a@x.com', 'ABC123']);
  await correr('hesego quitar completo', ['hesego', '4', 'a@x.com', 'ABC123', 'quizas', 'si', 'ABC123', 'XYZ987']);
  await correr('hesego quitar cancelar', ['hesego', '4', 'a@x.com', 'ABC123', 'no', '0']);
  await correr('hesego quitar unico usuario', ['hesego', '4', 'a@x.com', 'SOL111', 'si']);
  await correr('rastrear menu completo', ['rastrear', '1', 'rastrear', '2', 'ABC123', '0', 'rastrear', '3', 'rastrear', '4', 'rastrear', '7']);
  await correr('cointra menu', ['cointra', '1', 'cointra', '2', 'cointra', '5']);
  await correr('salir y menu sin conversacion', ['salir', 'menu', 'hesego', 'salir', 'menu']);
  await correr('palabras sueltas y bloqueo', ['hola', 'buenas', 'gracias', 'ok', 'quiero algo', 'hesego', 'rastrear']);
  const limite = persona('limite diario');
  reset();
  for (let i = 0; i < 104; i++) await limite(i % 2 ? 'hesego' : 'menu');

  fs.writeFileSync(salida, JSON.stringify(transcripcion, null, 1));
  log0('transcripcion guardada:', transcripcion.length, 'mensajes ->', salida);
  servidor.close(); process.exit(0);
})().catch(e => { console.log('ERR', String(e.stack).split('\n').slice(0, 5).join(' | ')); process.exit(1); });
