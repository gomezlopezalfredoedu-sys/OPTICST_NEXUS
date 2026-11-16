/* Boutique de Lentes Yael — PWA (vanilla JS, sin frameworks)
   Backend: Google Apps Script (web app) según API_CONTRACT.md.
   La URL y el token NO van en el código: se piden en la pantalla de
   configuración y se guardan en localStorage. Modo demo = datos en
   memoria, nada se guarda. */
'use strict';

/* ---------- Configuración ---------- */
const LS_URL = 'bly_api_url';
const LS_TOKEN = 'bly_api_token';
const LS_DEMO = 'bly_demo';
const NEGOCIO = {
  nombre: 'Boutique de Lentes Yael',
  sucursal: 'Calle 4',
  direccion: 'Calle 4 N° 342, Ciudad de México, 08100',
  telefonos: '5592405025 / 5611586976'
};
const GARANTIAS = { adaptacion: '30 días de adaptación', armazon: '6 meses armazón', tratamiento: '6 meses tratamiento' };
const PROXIMA_VISITA_MESES = 10;

const state = {
  demo: false,
  url: '',
  token: '',
  catalogs: null,
  wizard: { step: 1, cliente: null, historia: null, tipoVenta: 'lentes_completos', conArmazonLC: false },
  currentVentaId: null,
  currentDoc: null,       // {kind, venta}
  currentClienteId: null,
  pendientesSel: new Set(),
  materialesCache: null,
  corteCache: null
};

/* ---------- Utilidades ---------- */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const money = n => '$' + (Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const hoyISO = () => new Date().toISOString().slice(0, 10);
const fechaMX = d => {
  if (!d) return '—';
  const dt = new Date(d.length === 10 ? d + 'T12:00:00' : d);
  return isNaN(dt) ? String(d) : dt.toLocaleDateString('es-MX');
};
function edadDesde(fechaNac) {
  if (!fechaNac) return '';
  const n = new Date(fechaNac + 'T12:00:00'), h = new Date();
  let e = h.getFullYear() - n.getFullYear();
  if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) e--;
  return e;
}
function showError(msg, el) {
  const target = el || $('#globalError');
  if (!target) return;
  target.textContent = msg;
  target.hidden = false;
  setTimeout(() => { target.hidden = true; }, 12000);
}
function showOk(msg, el) {
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 8000);
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Rangos de graduación (según contrato; se usan solo si el backend no devuelve listas) ---------- */
function rangoEsfera() { const v = []; for (let x = -20; x <= 10.0001; x += 0.5) v.push(x.toFixed(2)); return v; }
function rangoCilindro() { const v = []; for (let x = 0; x >= -10.0001; x -= 0.5) v.push(x.toFixed(2)); return v; }
function rangoEje() { const v = []; for (let x = 0; x <= 180; x += 5) v.push(String(x)); return v; }
function rangoAdd() { const v = []; for (let x = 1; x <= 3.0001; x += 0.5) v.push('+' + x.toFixed(2)); return v; }
const SNELLEN = ['cuenta dedos', '20/400', '20/200', '20/100', '20/70', '20/50', '20/40', '20/30', '20/25', '20/20', '20/15', '20/13', '20/10'];
const FALLBACK_LISTAS = {
  Esfera: rangoEsfera(), Cilindro: rangoCilindro(), Eje: rangoEje(), Add: rangoAdd(),
  'Agudeza visual': SNELLEN,
  Material_Lente: ['Cristal', 'CR39', 'Poli', '1.67', '1.74'],
  Diseno_Lente: ['Monofocal', 'Bifocal', 'Progresivo', 'Lente de contacto'],
  Tipo_LC: ['Esférico', 'Tórico', 'Cosmético'],
  Tratamiento: ['AR', 'Foto AR', 'Blue', 'Blue Foto', 'Polar', 'W', 'Foto', 'Filtro color'],
  Filtro_Tono: ['1', '2', '3'],
  Material_Armazon: ['Metálico', 'Plástico', 'TR-90', 'Ultem', 'Aluminio', 'Titanio'],
  Diseno_Armazon: ['completo', 'ranurado', '3 piezas (tornillo)', '3 piezas (grapa)'],
  Motivo: ['Primera vez', 'Dolor de cabeza', 'Visión borrosa', 'Actualización de graduación', 'Lentes rotos'],
  Metodo_Pago: ['Efectivo', 'Transferencia', 'Tarjeta de débito', 'Tarjeta de crédito', 'Programas sociales'],
  Proveedor: ['Mia', 'H2O', 'Lensbest', 'INFONDI']
};
const MARCAS_LC_PRESTIGIO = ['Alcon', 'Johnson & Johnson', 'CooperVision', 'Bausch & Lomb'];
const MARCAS_LC_COSMETICO = ['Lunare', 'FreshLook'];

/* ---------- Catálogos demo (valores del contrato; en producción los devuelve getCatalogos) ---------- */
function demoCatalogs() {
  const preciosLentes = [
    ['Ar 1era', 25], ['Ar 2da', 52], ['Ar 3era', 70], ['Ar foto 1era', 55], ['Ar foto 2da', 75],
    ['Ar foto 3era', 110], ['Blue 1era', 65], ['Blue 2da', 90], ['Blue 3era', 130], ['Blue foto 1era', 130],
    ['Blue foto 2da', 170], ['Blue foto 3era', 210], ['Bifocal Ar', 44], ['Bifocal Ar foto', 120],
    ['Bifocal blue', 90], ['bifocal blue foto', 140], ['progresivo Ar', 80], ['Progresivo Ar foto', 120],
    ['Progresivo Blue', 140], ['progresivo blue foto', 240], ['1.67 blue', 200], ['1.67 doble asférica', 230],
    ['1.67 blue foto', 350], ['fotocromático de color', 85], ['poli Ar', 130], ['Poli Ar foto', 230],
    ['poli blue', 200], ['poli blue foto', 290], ['poli prog foto b', 300]
  ].map(([c, p]) => ({ concepto: c, precioEstimado: p }));
  const costosProduccion = [
    ['Bisel completo', 30], ['Bisel ranurado', 50], ['Bisel completo Poli', 80], ['Ranurado poli', 80],
    ['Bisel 3 pz tornillo', 80], ['Bisel 3 pz grapa', 100], ['Rebisel completo', 25], ['Rebisel ranurado', 35],
    ['Ranura', 10], ['Perforación', 15], ['Pulido de acetato', 45], ['Pulido metálico', 50],
    ['Cambio nylon', 35], ['Bisel de personaje', 150]
  ].map(([s, p]) => ({ servicio: s, precio: p }));
  const preciosLC = [
    { tipo: 'Esférico', marca: 'Alcon', precioSugerido: 300, precioReal: '', reemplazo: 'mensual' },
    { tipo: 'Esférico', marca: 'Johnson & Johnson', precioSugerido: 300, precioReal: '', reemplazo: 'mensual' },
    { tipo: 'Esférico', marca: 'CooperVision', precioSugerido: 300, precioReal: '', reemplazo: 'mensual' },
    { tipo: 'Esférico', marca: 'Bausch & Lomb', precioSugerido: 300, precioReal: '', reemplazo: 'mensual' },
    { tipo: 'Tórico', marca: 'Alcon', precioSugerido: 500, precioReal: '', reemplazo: 'mensual' },
    { tipo: 'Tórico', marca: 'Johnson & Johnson', precioSugerido: 500, precioReal: '', reemplazo: 'mensual' },
    { tipo: 'Tórico', marca: 'CooperVision', precioSugerido: 500, precioReal: '', reemplazo: 'mensual' },
    { tipo: 'Tórico', marca: 'Bausch & Lomb', precioSugerido: 500, precioReal: '', reemplazo: 'mensual' },
    { tipo: 'Cosmético', marca: 'Lunare', precioSugerido: 200, precioReal: '', reemplazo: 'mensual' },
    { tipo: 'Cosmético', marca: 'FreshLook', precioSugerido: 200, precioReal: '', reemplazo: 'mensual' }
  ];
  return {
    config: { Nombre: NEGOCIO.nombre, Sucursal: NEGOCIO.sucursal, Direccion: NEGOCIO.direccion, Telefonos: NEGOCIO.telefonos },
    armazones: [],
    preciosLentes, costosProduccion,
    conceptos: [
      { concepto: 'Rebisel completo', tipo: 'Rebisel', costoVenta: '', costoProduccion: 25 },
      { concepto: 'Rebisel ranurado', tipo: 'Rebisel', costoVenta: '', costoProduccion: 35 },
      { concepto: 'Kit de limpieza', tipo: 'Accesorio', costoVenta: '', costoAdquisicion: '' },
      { concepto: 'Cadena', tipo: 'Accesorio', costoVenta: '', costoAdquisicion: '' },
      { concepto: 'Estuche duro', tipo: 'Accesorio', costoVenta: '', costoAdquisicion: '' },
      { concepto: 'Estuche', tipo: 'Accesorio', costoVenta: '', costoAdquisicion: '' },
      { concepto: 'Microfibra', tipo: 'Accesorio', costoVenta: '', costoAdquisicion: '' }
    ],
    preciosLC,
    listas: FALLBACK_LISTAS
  };
}

/* ---------- Datos demo en memoria (nada se guarda) ---------- */
const demo = {
  clientes: [
    { id: 'CLI-0001', nombre: 'María González Pérez', fechaNac: '1990-05-12', edad: 36, telefono: '5512345678', ocupacion: 'Maestra', sexo: 'Femenino', proximaVisita: '' }
  ],
  historias: [
    { id: 'HC-0001', clienteId: 'CLI-0001', fecha: hoyISO(), usaLentes: 'sí', gradEsfOD: '-2.50', gradCilOD: '-0.50', gradEjeOD: '90', gradEsfOI: '-2.25', gradCilOI: '-0.50', gradEjeOI: '85', gradAdd: '', dnp: '62', diagnostico: 'Miopía y astigmatismo', recomendacion: 'Monofocal, Blue, Poli' }
  ],
  ventas: [
    { id: 'VTA-0001', folio: 'VTA-0001', clienteId: 'CLI-0001', clienteNombre: 'María González Pérez', telefono: '5512345678', fecha: hoyISO(), tipoVenta: 'lentes_completos', armazonMaterial: 'Metálico', armazonDiseno: 'completo', armazonModelo: 'Agatha', armazonMarca: '', armazonColor: 'Negro mate', armazonPrecioDef: 499, lenteMaterial: 'Poli', lenteDiseno: 'Monofocal', lenteTratamiento: 'Blue', lenteProveedor: 'Mia', lentePrecioDef: 200, precioDefTotal: 699, totalManual: 699, descuento: 0, costoFinalInversion: 200, costoProduccion: 30, estucheMicrofibra: 'sí', aCuenta: 200, saldo: 499, estado: 'Pendiente de entrega', graduacion: { esfOD: '-2.50', cilOD: '-0.50', ejeOD: '90', esfOI: '-2.25', cilOI: '-0.50', ejeOI: '85', add: '', dnp: '62' }, pagos: [{ fecha: hoyISO(), monto: 200, metodo: 'Efectivo', concepto: 'anticipo' }] }
  ],
  trabajos: [
    { ventaId: 'VTA-0001', clienteId: 'CLI-0001', clienteNombre: 'María González Pérez', estado: 'Pendiente de entrega', fechaEntrega: '' }
  ],
  gastos: [],
  fondo: { saldo: 30, movimientos: [{ fecha: hoyISO(), tipo: 'entrada', concepto: 'Costo de producción VTA-0001', monto: 30, saldo: 30 }] },
  cortes: [],
  correcciones: [],
  nextCliente: 2, nextVenta: 2
};

/* ---------- Llamadas al backend ---------- */
async function api(action, params) {
  params = params || {};
  if (state.demo) return demoApi(action, params);
  if (!state.url || !state.token) throw new Error('Falta configurar la URL del web app y el token.');
  let res;
  try {
    res = await fetch(state.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ token: state.token, action }, params))
    });
  } catch (e) {
    throw new Error('No se pudo conectar con el backend: ' + e.message);
  }
  let json;
  try { json = await res.json(); } catch (e) { throw new Error('El backend no devolvió JSON válido.'); }
  if (!json.ok) throw new Error(json.error || 'Error del backend');
  return json.data;
}

function demoApi(action, p) {
  switch (action) {
    case 'ping': return Promise.resolve({ version: '1.0.0-demo' });
    case 'getCatalogos': return Promise.resolve(demoCatalogs());
    case 'buscarCliente': {
      const q = (p.q || '').toLowerCase();
      return Promise.resolve(demo.clientes.filter(c => c.nombre.toLowerCase().includes(q)));
    }
    case 'getCliente': {
      const c = demo.clientes.find(x => x.id === p.id);
      if (!c) throw new Error('Cliente no encontrado (demo).');
      return Promise.resolve({ cliente: c, historias: demo.historias.filter(h => h.clienteId === p.id), ventas: demo.ventas.filter(v => v.clienteId === p.id) });
    }
    case 'crearCliente': {
      const id = 'CLI-' + String(demo.nextCliente++).padStart(4, '0');
      const c = { id, nombre: p.nombre, fechaNac: p.fechaNac, edad: edadDesde(p.fechaNac), telefono: p.telefono || '', ocupacion: p.ocupacion || '', sexo: p.sexo || '' };
      demo.clientes.push(c);
      return Promise.resolve({ id });
    }
    case 'guardarHistoria': {
      const id = 'HC-' + String(demo.historias.length + 1).padStart(4, '0');
      demo.historias.push(Object.assign({ id, fecha: hoyISO() }, p));
      return Promise.resolve({ id });
    }
    case 'crearVenta': {
      const folio = 'VTA-' + String(demo.nextVenta).padStart(4, '0');
      const id = folio;
      demo.nextVenta++;
      const total = Number(p.totalManual || 0);
      const aCuenta = p.anticipo ? Number(p.anticipo.monto || 0) : 0;
      const v = Object.assign({}, p, {
        id, folio, fecha: hoyISO(), aCuenta, saldo: total - aCuenta,
        estado: 'En proceso', pagos: p.anticipo ? [{ fecha: hoyISO(), monto: aCuenta, metodo: p.anticipo.metodo, concepto: p.anticipo.concepto }] : []
      });
      demo.ventas.push(v);
      demo.trabajos.push({ ventaId: id, clienteId: p.clienteId, clienteNombre: v.clienteNombre || '', estado: 'En proceso', fechaEntrega: '' });
      if (p.costoProduccion) {
        const m = Number(p.costoProduccion) || 0;
        demo.fondo.saldo += m;
        demo.fondo.movimientos.push({ fecha: hoyISO(), tipo: 'entrada', concepto: 'Costo de producción ' + folio, monto: m, saldo: demo.fondo.saldo });
      }
      return Promise.resolve({ ventaId: id, folio, trabajoId: id });
    }
    case 'registrarAbono': {
      const v = demo.ventas.find(x => x.id === p.ventaId);
      if (!v) throw new Error('Venta no encontrada (demo).');
      if (!(p.monto > 0) || p.monto > v.saldo) throw new Error('Monto inválido: debe ser mayor a 0 y no mayor al saldo.');
      v.aCuenta += Number(p.monto); v.saldo -= Number(p.monto);
      v.pagos.push({ fecha: hoyISO(), monto: Number(p.monto), metodo: p.metodo, concepto: p.concepto });
      if (v.saldo === 0) v.estado = 'liquidado';
      return Promise.resolve({ saldo: v.saldo });
    }
    case 'getPendientes': return Promise.resolve(demo.trabajos.filter(t => t.estado === 'Pendiente de entrega').map(t => Object.assign({}, t, { venta: demo.ventas.find(v => v.id === t.ventaId) })));
    case 'getEnProceso': return Promise.resolve(demo.trabajos.filter(t => t.estado === 'En proceso').map(t => Object.assign({}, t, { venta: demo.ventas.find(v => v.id === t.ventaId) })));
    case 'cambiarEstadoTrabajo': {
      const t = demo.trabajos.find(x => x.ventaId === p.ventaId);
      if (t) t.estado = p.estado;
      const v = demo.ventas.find(x => x.id === p.ventaId);
      if (v) v.estado = p.estado;
      return Promise.resolve({ ok: true });
    }
    case 'marcarEntregados': {
      (p.ventaIds || []).forEach(id => {
        const t = demo.trabajos.find(x => x.ventaId === id);
        if (t) { t.estado = 'Entregado'; t.fechaEntregado = hoyISO(); }
        const v = demo.ventas.find(x => x.id === id);
        if (v) v.estado = 'Entregado';
      });
      return Promise.resolve({ ok: true });
    }
    case 'getResumen': {
      const porMetodo = {};
      demo.ventas.forEach(v => (v.pagos || []).forEach(pg => { porMetodo[pg.metodo] = (porMetodo[pg.metodo] || 0) + Number(pg.monto); }));
      const cobrado = Object.values(porMetodo).reduce((a, b) => a + b, 0);
      const gastos = demo.gastos.reduce((a, g) => a + Number(g.monto), 0);
      return Promise.resolve({ ventas: demo.ventas.length, cobrado, porMetodo, gastos, fondo: demo.fondo.saldo, periodo: p.periodo });
    }
    case 'registrarGasto': {
      const g = { id: 'GAS-' + (demo.gastos.length + 1), fecha: p.fecha, concepto: p.concepto, monto: Number(p.monto), metodo: p.metodo, comprobante: p.comprobante || '' };
      demo.gastos.push(g);
      return Promise.resolve({ id: g.id });
    }
    case 'getGastos': return Promise.resolve(demo.gastos);
    case 'getFondo': return Promise.resolve(demo.fondo);
    case 'registrarSalidaFondo': {
      if (Number(p.monto) > demo.fondo.saldo) throw new Error('Saldo insuficiente en el fondo.');
      demo.fondo.saldo -= Number(p.monto);
      demo.fondo.movimientos.push({ fecha: hoyISO(), tipo: 'salida', concepto: p.concepto, monto: Number(p.monto), saldo: demo.fondo.saldo });
      return Promise.resolve({ saldo: demo.fondo.saldo });
    }
    case 'getCorteCaja': {
      const porMetodo = { efectivo: 0, tarjeta: 0, transferencia: 0, programasSociales: 0 };
      demo.ventas.forEach(v => (v.pagos || []).forEach(pg => {
        if (pg.fecha !== p.fecha) return;
        const m = String(pg.metodo).toLowerCase();
        if (m.includes('efectivo')) porMetodo.efectivo += Number(pg.monto);
        else if (m.includes('tarjeta')) porMetodo.tarjeta += Number(pg.monto);
        else if (m.includes('transferencia')) porMetodo.transferencia += Number(pg.monto);
        else if (m.includes('programa')) porMetodo.programasSociales += Number(pg.monto);
      }));
      const gastosDia = demo.gastos.filter(g => g.fecha === p.fecha).reduce((a, g) => a + Number(g.monto), 0);
      const totalCaja = porMetodo.efectivo - gastosDia;
      return Promise.resolve({ esperado: porMetodo, gastosDia, totalCaja });
    }
    case 'guardarCorteCaja': {
      demo.cortes.push({ fecha: p.fecha, contado: p.contado, diferencia: p.diferencia });
      return Promise.resolve({ id: 'CORTE-' + demo.cortes.length });
    }
    case 'corregir': {
      demo.correcciones.push({ ventaId: p.ventaId, campo: p.campo, valorAnterior: p.valorAnterior, valorNuevo: p.valorNuevo, justificacion: p.justificacion, fecha: hoyISO() });
      const v = demo.ventas.find(x => x.id === p.ventaId);
      if (v && p.campo === 'precio') v.totalManual = Number(p.valorNuevo) || v.totalManual;
      return Promise.resolve({ ok: true });
    }
    case 'getListaMateriales': {
      const abiertas = demo.ventas.filter(v => v.estado !== 'Entregado');
      return Promise.resolve({
        micas: abiertas.filter(v => v.tipoVenta !== 'accesorio').map(v => ({ folio: v.folio, cliente: v.clienteNombre, graduacion: v.graduacion, material: v.lenteMaterial || v.lcTipo || '', diseno: v.lenteDiseno || '', tratamiento: v.lenteTratamiento || '', proveedor: v.lenteProveedor || '' })),
        armazones: abiertas.filter(v => v.armazonModelo || v.armazonMaterial).map(v => ({ folio: v.folio, cliente: v.clienteNombre, material: v.armazonMaterial, diseno: v.armazonDiseno, modelo: v.armazonModelo, marca: v.armazonMarca, color: v.armazonColor }))
      });
    }
    case 'getLibroVisitas': {
      const c = demo.clientes.find(x => x.id === p.clienteId);
      return Promise.resolve({ cliente: c, historias: demo.historias.filter(h => h.clienteId === p.clienteId), ventas: demo.ventas.filter(v => v.clienteId === p.clienteId) });
    }
    case 'getVenta': {
      const v = demo.ventas.find(x => x.id === p.ventaId);
      if (!v) throw new Error('Venta no encontrada (demo).');
      const c = demo.clientes.find(x => x.id === v.clienteId);
      const h = demo.historias.filter(x => x.clienteId === v.clienteId).slice(-1)[0] || null;
      return Promise.resolve({ venta: v, cliente: c, historia: h, pagos: v.pagos || [] });
    }
    default: return Promise.reject(new Error('Acción no soportada en demo: ' + action));
  }
}

/* ---------- Catálogos: listas para los desplegables ---------- */
function lista(nombre) {
  const l = state.catalogs && state.catalogs.listas;
  if (l) {
    if (Array.isArray(l[nombre])) return l[nombre];
    if (Array.isArray(l)) { // formato [{Lista, Valor}] del Sheet
      return l.filter(r => r.Lista === nombre || r.lista === nombre).map(r => r.Valor || r.valor);
    }
  }
  return FALLBACK_LISTAS[nombre] || [];
}
function fillSelect(el, values, placeholder) {
  if (!el) return;
  const cur = el.value;
  el.innerHTML = '';
  if (placeholder) { const o = document.createElement('option'); o.value = ''; o.textContent = placeholder; el.appendChild(o); }
  (values || []).forEach(v => {
    const o = document.createElement('option');
    o.value = String(v); o.textContent = String(v);
    el.appendChild(o);
  });
  if (cur && Array.from(el.options).some(o => o.value === cur)) el.value = cur;
}
function fillRxSelects() {
  const esf = lista('Esfera'), cil = lista('Cilindro'), eje = lista('Eje'), add = lista('Add');
  $$('.lens-esf-od, .lens-esf-oi').forEach(s => fillSelect(s, esf, 'Esf'));
  $$('.lens-cil-od, .lens-cil-oi').forEach(s => fillSelect(s, cil, 'Cil'));
  $$('.lens-eje-od, .lens-eje-oi').forEach(s => fillSelect(s, eje, 'Eje'));
  ['#gradEsfOd', '#gradEsfOi'].forEach(s => fillSelect($(s), esf, 'Esf'));
  ['#gradCilOd', '#gradCilOi'].forEach(s => fillSelect($(s), cil, 'Cil'));
  ['#gradEjeOd', '#gradEjeOi'].forEach(s => fillSelect($(s), eje, 'Eje'));
  fillSelect($('#lensAdd'), add, 'Add');
  fillSelect($('#gradAdd'), add, 'Add');
}
function fillCatalogSelects() {
  fillSelect($('#armMaterial'), lista('Material_Armazon'), '—');
  fillSelect($('#armDiseno'), lista('Diseno_Armazon'), '—');
  fillSelect($('#lenteMaterial'), lista('Material_Lente'), '—');
  fillSelect($('#lenteDiseno'), lista('Diseno_Lente'), '—');
  fillSelect($('#lenteTratamiento'), lista('Tratamiento'), '—');
  fillSelect($('#lenteProveedor'), lista('Proveedor'), '—');
  fillSelect($('#hcMotivo'), lista('Motivo'), '—');
  fillSelect($('#lensDiseno'), lista('Diseno_Lente'), '—');
  fillSelect($('#pMetodo'), lista('Metodo_Pago'), '—');
  fillSelect($('#gastoMetodo'), lista('Metodo_Pago'), '—');
  fillSelect($('#abonoMetodo'), lista('Metodo_Pago'), '—');
  const costos = (state.catalogs && state.catalogs.costosProduccion) || [];
  fillSelect($('#pCostoProd'), costos.map(c => (c.servicio || c.Servicio) + ' — $' + (c.precio || c.Precio)), '—');
  const precios = (state.catalogs && state.catalogs.preciosLentes) || [];
  fillSelect($('#lenteConcepto'), precios.map(c => (c.concepto || c.Concepto) + ' — $' + (c.precioEstimado || c.Precio_Estimado || '')), '—');
  fillSelect($('#lcMarca'), MARCAS_LC_PRESTIGIO, '—');
  // Agudeza visual: 6 selects (sin/con × OD/OI/AO)
  const av = $('#avGrid');
  if (av && !av.children.length) {
    [['Sin Rx · O.D.', 'avSinOd'], ['Sin Rx · O.I.', 'avSinOi'], ['Sin Rx · A/O', 'avSinAo'],
     ['Con Rx · O.D.', 'avConOd'], ['Con Rx · O.I.', 'avConOi'], ['Con Rx · A/O', 'avConAo']].forEach(([label, id]) => {
      const lab = document.createElement('label');
      lab.textContent = label;
      const sel = document.createElement('select');
      sel.id = id;
      lab.appendChild(sel);
      av.appendChild(lab);
      fillSelect(sel, lista('Agudeza visual'), '—');
    });
  }
}
async function loadCatalogs() {
  try {
    state.catalogs = await api('getCatalogos');
  } catch (e) {
    showError('No se pudieron cargar los catálogos: ' + e.message + ' Se usan las listas del contrato como respaldo.');
    state.catalogs = demoCatalogs();
  }
  fillRxSelects();
  fillCatalogSelects();
}

/* ---------- Navegación ---------- */
const VIEWS = ['setup', 'home', 'nueva-venta', 'buscar-cliente', 'libro-visitas', 'pendientes', 'en-proceso', 'resumen', 'lista-materiales', 'catalogos', 'venta', 'doc'];
function show(view) {
  VIEWS.forEach(v => { const el = $('#view-' + v); if (el) el.hidden = (v !== view); });
  window.scrollTo(0, 0);
  if (view === 'pendientes') cargarPendientes();
  if (view === 'en-proceso') cargarEnProceso();
  if (view === 'resumen') { $('#gastoFecha').value = hoyISO(); $('#corteFecha').value = hoyISO(); cargarResumen(); cargarFondo(); }
  if (view === 'lista-materiales') cargarMateriales();
  if (view === 'catalogos') cargarCatalogosView();
}
function goHome() { show('home'); }

/* ---------- Asistente de nueva venta ---------- */
function setStep(n) {
  state.wizard.step = n;
  $$('#wizardSteps li').forEach(li => {
    const s = Number(li.dataset.step);
    li.classList.toggle('active', s === n);
    li.classList.toggle('done', s < n);
  });
  $$('[data-step-panel]').forEach(p => { p.hidden = Number(p.dataset.stepPanel) !== n; });
  $('#btnWizardBack').disabled = (n === 1);
  $('#btnWizardNext').textContent = (n === 6) ? 'Terminar' : 'Siguiente →';
  if (n === 5) actualizarPrecios();
  if (n === 6) renderConfirmacion();
}
function wizardNext() {
  const n = state.wizard.step;
  if (n === 1 && !state.wizard.cliente) { showError('Elige o crea un cliente para continuar.', $('#wizardError')); return; }
  if (n === 2) { if (!guardarHistoriaLocal()) return; }
  if (n === 3) { aplicarTipoVenta(); }
  if (n === 6) { goHome(); return; }
  $('#wizardError').hidden = true;
  setStep(n + 1);
}
function wizardBack() { if (state.wizard.step > 1) setStep(state.wizard.step - 1); }

function seleccionarCliente(c) {
  state.wizard.cliente = c;
  const p = $('#nvClienteSel');
  p.textContent = 'Cliente seleccionado: ' + c.nombre + ' (' + c.id + ')' + (c.edad ? ' · ' + c.edad + ' años' : '');
  p.hidden = false;
}
async function buscarClienteNv() {
  const q = $('#nvBuscar').value.trim();
  if (!q) return;
  try {
    const res = await api('buscarCliente', { q });
    const box = $('#nvResultados');
    box.innerHTML = res.length ? '' : '<p class="hint">Sin resultados. Crea el cliente nuevo abajo.</p>';
    res.forEach(c => {
      const d = document.createElement('div');
      d.className = 'list-item';
      d.innerHTML = '<strong>' + esc(c.nombre) + '</strong><small>' + esc(c.id || '') + ' · ' + esc(c.telefono || '') + '</small>';
      const b = document.createElement('button');
      b.className = 'btn btn-secondary'; b.type = 'button'; b.textContent = 'Usar este cliente';
      b.onclick = () => seleccionarCliente(c);
      d.appendChild(b);
      box.appendChild(d);
    });
  } catch (e) { showError('Error al buscar: ' + e.message, $('#wizardError')); }
}
async function crearClienteNv() {
  const nombre = $('#nvNombre').value.trim();
  const fechaNac = $('#nvFechaNac').value;
  if (!nombre || !fechaNac) { showError('Nombre y fecha de nacimiento son obligatorios.', $('#wizardError')); return; }
  try {
    const r = await api('crearCliente', { nombre, fechaNac, telefono: $('#nvTelefono').value.trim(), ocupacion: $('#nvOcupacion').value.trim(), sexo: $('#nvSexo').value });
    seleccionarCliente({ id: r.id, nombre, fechaNac, edad: edadDesde(fechaNac), telefono: $('#nvTelefono').value.trim(), ocupacion: $('#nvOcupacion').value.trim(), sexo: $('#nvSexo').value });
    showOk('Cliente creado: ' + r.id, $('#nvClienteSel'));
  } catch (e) { showError('No se pudo crear el cliente: ' + e.message, $('#wizardError')); }
}
function guardarHistoriaLocal() {
  const h = {
    usaLentes: $('#hcUsaLentes').value,
    lensEsfOD: $('.lens-esf-od').value, lensCilOD: $('.lens-cil-od').value, lensEjeOD: $('.lens-eje-od').value,
    lensEsfOI: $('.lens-esf-oi').value, lensCilOI: $('.lens-cil-oi').value, lensEjeOI: $('.lens-eje-oi').value,
    lensTratamientos: $('#lensTrat').value.trim(), lensDiseno: $('#lensDiseno').value, lensAdd: $('#lensAdd').value, lensDnp: $('#lensDnp').value,
    motivo: $('#hcMotivo').value,
    antTipo: $('#antTipo').value, antDiabetes: $('#antDiabetes').checked, antHipertension: $('#antHipertension').checked, antMigrana: $('#antMigrana').checked,
    avSinOD: $('#avSinOd') && $('#avSinOd').value, avSinOI: $('#avSinOi') && $('#avSinOi').value, avSinAO: $('#avSinAo') && $('#avSinAo').value,
    avConOD: $('#avConOd') && $('#avConOd').value, avConOI: $('#avConOi') && $('#avConOi').value, avConAO: $('#avConAo') && $('#avConAo').value,
    gradEsfOD: $('#gradEsfOd').value, gradCilOD: $('#gradCilOd').value, gradEjeOD: $('#gradEjeOd').value,
    gradEsfOI: $('#gradEsfOi').value, gradCilOI: $('#gradCilOi').value, gradEjeOI: $('#gradEjeOi').value,
    gradAdd: $('#gradAdd').value, dnp: $('#gradDnp').value,
    diagnostico: $('#hcDiagnostico').value.trim(), indicaciones: $('#hcIndicaciones').value.trim(), recomendacion: $('#hcRecomendacion').value.trim()
  };
  if (!h.gradEsfOD && !h.gradEsfOI && !h.motivo) {
    showError('Captura al menos la graduación del examen o el motivo de consulta.', $('#wizardError'));
    return false;
  }
  state.wizard.historia = h;
  $('#lenteDnpEcho').textContent = h.dnp ? h.dnp + ' mm' : '—';
  return true;
}
function aplicarTipoVenta() {
  const tipo = (document.querySelector('input[name="tipoVenta"]:checked') || {}).value || 'lentes_completos';
  state.wizard.tipoVenta = tipo;
  state.wizard.conArmazonLC = $('#lcConArmazon').checked;
  $('#fsArmazon').hidden = !(tipo === 'lentes_completos' || tipo === 'rebisel' || (tipo === 'lente_contacto' && state.wizard.conArmazonLC));
  $('#lcConArmazonWrap').hidden = (tipo !== 'lente_contacto');
  $('#fsRebisel').hidden = (tipo !== 'rebisel');
  $('#fsAccesorio').hidden = (tipo !== 'accesorio');
  $('#fsLC').hidden = (tipo !== 'lente_contacto');
  const llevaLente = (tipo === 'lentes_completos' || tipo === 'rebisel');
  $('#fsLente').hidden = !llevaLente;
  $('#lenteSkipMsg').hidden = llevaLente;
  if (tipo === 'lente_contacto') actualizarMarcasLC();
}
function actualizarMarcasLC() {
  const tipo = $('#lcTipo').value;
  const marcas = tipo === 'Cosmético' ? MARCAS_LC_COSMETICO : MARCAS_LC_PRESTIGIO;
  fillSelect($('#lcMarca'), marcas, '—');
  // Precio sugerido de la lista de LC (precio real si existe, si no el sugerido)
  const pl = (state.catalogs && state.catalogs.preciosLC) || [];
  const fila = pl.find(r => (r.tipo || r.Tipo) === tipo && marcas.includes(r.marca || r.Marca));
  if (fila) {
    const real = fila.precioReal || fila.Precio_Real;
    const sug = fila.precioSugerido || fila.Precio_Sugerido;
    $('#lcPrecio').value = real !== '' && real != null ? real : (sug || '');
  }
}
function precioDefinidoTotal() {
  const tipo = state.wizard.tipoVenta;
  let arm = 0, len = 0;
  if (tipo === 'lentes_completos' || tipo === 'rebisel' || (tipo === 'lente_contacto' && state.wizard.conArmazonLC)) arm = Number($('#armPrecio').value || 0);
  if (tipo === 'lentes_completos' || tipo === 'rebisel') len = Number($('#lentePrecio').value || 0);
  if (tipo === 'lente_contacto') len = Number($('#lcPrecio').value || 0);
  if (tipo === 'rebisel') { arm = Number($('#rebiselPrecio').value || 0); len = 0; }
  if (tipo === 'accesorio') { arm = Number($('#accPrecio').value || 0); len = 0; }
  return { arm, len, total: arm + len };
}
function actualizarPrecios() {
  const d = precioDefinidoTotal();
  $('#pArmazon').value = d.arm.toFixed(2);
  $('#pLente').value = d.len.toFixed(2);
  $('#pTotalDef').value = d.total.toFixed(2);
  const manual = Number($('#pTotalManual').value || 0);
  $('#pDescuento').value = (d.total - manual).toFixed(2);
  const aCuenta = Number($('#pACuenta').value || 0);
  $('#pSaldo').textContent = money(manual - aCuenta);
}
function renderConfirmacion() {
  const c = state.wizard.cliente, h = state.wizard.historia, tipo = state.wizard.tipoVenta;
  const d = precioDefinidoTotal();
  const manual = Number($('#pTotalManual').value || 0);
  const tipoTxt = { lentes_completos: 'Lentes completos (armazón + lente)', rebisel: 'Rebisel', accesorio: 'Accesorio', lente_contacto: 'Lente de contacto' }[tipo];
  $('#confirmResumen').innerHTML =
    '<table><tr><th>Cliente</th><td>' + esc(c ? c.nombre : '—') + '</td></tr>' +
    '<tr><th>Tipo de venta</th><td>' + esc(tipoTxt) + '</td></tr>' +
    '<tr><th>Graduación OD</th><td>Esf ' + esc(h.gradEsfOD || '—') + ' · Cil ' + esc(h.gradCilOD || '—') + ' · Eje ' + esc(h.gradEjeOD || '—') + '</td></tr>' +
    '<tr><th>Graduación OI</th><td>Esf ' + esc(h.gradEsfOI || '—') + ' · Cil ' + esc(h.gradCilOI || '—') + ' · Eje ' + esc(h.gradEjeOI || '—') + '</td></tr>' +
    '<tr><th>Add / DNP</th><td>' + esc(h.gradAdd || '—') + ' / ' + esc(h.dnp || '—') + '</td></tr>' +
    '<tr><th>Precio definido</th><td>' + money(d.total) + '</td></tr>' +
    '<tr><th>Total manual</th><td>' + money(manual) + '</td></tr>' +
    '<tr><th>Descuento</th><td>' + money(d.total - manual) + '</td></tr>' +
    '<tr><th>A cuenta</th><td>' + money($('#pACuenta').value || 0) + ' (' + esc($('#pMetodo').value || '') + ' · ' + esc($('#pConcepto').value || '') + ')</td></tr>' +
    '<tr><th>Saldo</th><td>' + money(manual - Number($('#pACuenta').value || 0)) + '</td></tr></table>';
}
function costoProduccionSeleccionado() {
  const sel = $('#pCostoProd');
  if (!sel || !sel.value) return 0;
  const m = sel.value.match(/\$([\d.]+)/);
  return m ? Number(m[1]) : 0;
}
async function guardarVenta() {
  const c = state.wizard.cliente, h = state.wizard.historia;
  if (!c || !h) { showError('Falta cliente o historia clínica.', $('#wizardError')); return; }
  const tipo = state.wizard.tipoVenta;
  const d = precioDefinidoTotal();
  const totalManual = Number($('#pTotalManual').value || 0);
  if (!(totalManual > 0)) { showError('Captura el total manual de la venta.', $('#wizardError')); return; }
  const aCuenta = Number($('#pACuenta').value || 0);
  const payload = {
    clienteId: c.id, clienteNombre: c.nombre, telefono: c.telefono || '',
    tipoVenta: tipo,
    armazonMaterial: $('#armMaterial').value, armazonDiseno: $('#armDiseno').value,
    armazonModelo: $('#armModelo').value.trim(), armazonMarca: $('#armMarca').value.trim(),
    armazonColor: $('#armColor').value.trim(), armazonPrecioDef: d.arm,
    lenteMaterial: $('#lenteMaterial').value, lenteDiseno: $('#lenteDiseno').value,
    lenteTratamiento: $('#lenteTratamiento').value + ($('#filtroTonoWrap').hidden ? '' : ' filtro tono ' + $('#filtroTono').value),
    lenteProveedor: $('#lenteProveedor').value, lentePrecioDef: d.len,
    lcTipo: $('#lcTipo').value, lcMarca: $('#lcMarca').value, lcCurvaBase: $('#lcCurvaBase').value.trim(),
    lcDiametro: $('#lcDiametro').value.trim(), lcPrecioDef: tipo === 'lente_contacto' ? d.len : '',
    rebiselConcepto: $('#rebiselConcepto').value, accesorioDesc: $('#accDesc').value,
    precioDefTotal: d.total, totalManual, descuento: d.total - totalManual,
    costoFinalInversion: Number($('#pCostoInversion').value || 0),
    costoProduccion: costoProduccionSeleccionado(),
    estucheMicrofibra: tipo === 'lentes_completos' ? 'sí' : 'no',
    graduacion: { esfOD: h.gradEsfOD, cilOD: h.gradCilOD, ejeOD: h.gradEjeOD, esfOI: h.gradEsfOI, cilOI: h.gradCilOI, ejeOI: h.gradEjeOI, add: h.gradAdd, dnp: h.dnp }
  };
  if (aCuenta > 0) payload.anticipo = { monto: aCuenta, metodo: $('#pMetodo').value, concepto: $('#pLiquidar').checked ? 'liquidación' : $('#pConcepto').value };
  try {
    // La historia clínica se guarda primero (una sola vez) y luego la venta.
    await api('guardarHistoria', Object.assign({ clienteId: c.id }, h));
    const r = await api('crearVenta', payload);
    state.currentVentaId = r.ventaId;
    const ok = $('#ventaGuardada');
    ok.textContent = 'Venta guardada: folio ' + r.folio + ' · ' + (aCuenta >= totalManual ? 'Liquidada' : 'Saldo ' + money(totalManual - aCuenta)) + '. Próxima visita en 10 meses.';
    ok.hidden = false;
    $('#docsAfterSave').hidden = false;
    $('#btnGuardarVenta').disabled = true;
  } catch (e) {
    showError('No se pudo guardar la venta: ' + e.message, $('#wizardError'));
  }
}

/* ---------- Buscar cliente / Libro de visitas ---------- */
function clienteItemHTML(c) {
  return '<strong>' + esc(c.nombre) + '</strong><small>' + esc(c.id || '') + ' · ' + esc(c.telefono || '') + (c.edad ? ' · ' + c.edad + ' años' : '') + '</small>';
}
async function buscarClientes(q, boxEl, onPick) {
  if (!q) return;
  try {
    const res = await api('buscarCliente', { q });
    boxEl.innerHTML = res.length ? '' : '<p class="hint">Sin resultados.</p>';
    res.forEach(c => {
      const d = document.createElement('div');
      d.className = 'list-item';
      d.innerHTML = clienteItemHTML(c);
      const b = document.createElement('button');
      b.className = 'btn btn-secondary'; b.type = 'button'; b.textContent = 'Ver ficha';
      b.onclick = () => onPick(c);
      d.appendChild(b);
      boxEl.appendChild(d);
    });
  } catch (e) { showError('Error al buscar: ' + e.message); }
}
function ventaResumenHTML(v) {
  return '<div class="list-item"><div class="row"><strong>' + esc(v.folio || v.id) + '</strong><span>' + fechaMX(v.fecha) + '</span><span>' + money(v.totalManual) + '</span><span>Saldo: ' + money(v.saldo) + '</span><span>' + esc(v.estado || '') + '</span></div>' +
    '<small>' + esc(v.tipoVenta || '') + (v.armazonModelo ? ' · ' + esc(v.armazonModelo) : '') + (v.lenteMaterial ? ' · ' + esc(v.lenteMaterial) : '') + '</small>' +
    '<div class="row"><button class="btn btn-secondary" type="button" data-open-venta="' + esc(v.id) + '">Ver ficha</button>' +
    '<button class="btn btn-secondary" type="button" data-doc-venta="' + esc(v.id) + '" data-doc="ticket">Ticket</button>' +
    '<button class="btn btn-secondary" type="button" data-doc-venta="' + esc(v.id) + '" data-doc="comprobante">Comprobante</button></div></div>';
}
async function mostrarFichaCliente(c) {
  try {
    const d = await api('getCliente', { id: c.id });
    state.currentClienteId = c.id;
    const box = $('#bcFicha');
    const prox = d.cliente.proximaVisita ? '<p><strong>Próxima visita:</strong> ' + fechaMX(d.cliente.proximaVisita) + '</p>' : '';
    box.innerHTML = '<div class="card"><h3>' + esc(d.cliente.nombre) + '</h3>' +
      '<p>' + esc(d.cliente.id || '') + ' · ' + esc(d.cliente.telefono || '') + ' · ' + esc(d.cliente.ocupacion || '') + ' · ' + esc(d.cliente.sexo || '') + '</p>' + prox +
      '<h4>Historias clínicas (' + d.historias.length + ')</h4>' +
      (d.historias.map(h => '<p><small>' + fechaMX(h.fecha) + ' — Grad. OD Esf ' + esc(h.gradEsfOD || h.grad_esf_od || '—') + ' / OI Esf ' + esc(h.gradEsfOI || h.grad_esf_oi || '—') + ' — ' + esc(h.diagnostico || h.Diagnostico || '') + '</small></p>').join('') || '<p class="hint">Sin historias registradas.</p>') +
      '<h4>Ventas (' + d.ventas.length + ')</h4><div class="list">' + (d.ventas.map(ventaResumenHTML).join('') || '<p class="hint">Sin ventas.</p>') + '</div></div>';
    wireVentaButtons(box);
  } catch (e) { showError('No se pudo cargar la ficha: ' + e.message); }
}
async function mostrarExpediente(c) {
  try {
    const d = await api('getLibroVisitas', { clienteId: c.id });
    const box = $('#lvExpediente');
    box.innerHTML = '<div class="card"><h3>Expediente · ' + esc(d.cliente.nombre) + '</h3>' +
      '<p>' + esc(d.cliente.id || '') + ' · Nac. ' + fechaMX(d.cliente.fechaNac) + ' (' + esc(String(d.cliente.edad || '')) + ' años) · ' + esc(d.cliente.telefono || '') + '</p>' +
      '<h4>Visitas e historial de graduación</h4>' +
      (d.historias.map(h => '<div class="list-item"><strong>' + fechaMX(h.fecha) + '</strong><small>Graduación OD: Esf ' + esc(h.gradEsfOD || '—') + ' Cil ' + esc(h.gradCilOD || '—') + ' Eje ' + esc(h.gradEjeOD || '—') + ' · OI: Esf ' + esc(h.gradEsfOI || '—') + ' Cil ' + esc(h.gradCilOI || '—') + ' Eje ' + esc(h.gradEjeOI || '—') + ' · Add ' + esc(h.gradAdd || '—') + ' · DNP ' + esc(h.dnp || '—') + '</small><small>Diagnóstico: ' + esc(h.diagnostico || '') + ' · Recomendación: ' + esc(h.recomendacion || '') + '</small><div class="row"><button class="btn btn-secondary" type="button" data-doc-historia="' + esc(h.id || '') + '">Ver historia clínica</button></div></div>').join('') || '<p class="hint">Sin visitas registradas.</p>') +
      '<h4>Ventas</h4><div class="list">' + (d.ventas.map(ventaResumenHTML).join('') || '<p class="hint">Sin ventas.</p>') + '</div></div>';
    wireVentaButtons(box);
    $$('[data-doc-historia]', box).forEach(b => b.onclick = () => abrirDoc('historia', null, { historiaId: b.dataset.docHistoria, clienteId: c.id }));
  } catch (e) { showError('No se pudo cargar el expediente: ' + e.message); }
}
function wireVentaButtons(root) {
  $$('[data-open-venta]', root).forEach(b => b.onclick = () => abrirFichaVenta(b.dataset.openVenta));
  $$('[data-doc-venta]', root).forEach(b => b.onclick = () => abrirDoc(b.dataset.doc, b.dataset.docVenta));
}

/* ---------- Pendientes / En proceso ---------- */
async function cargarPendientes() {
  const box = $('#pendList');
  box.innerHTML = '<p class="hint">Cargando…</p>';
  try {
    const items = await api('getPendientes');
    state.pendientesSel = new Set();
    if (!items.length) { box.innerHTML = '<p class="hint">No hay trabajos pendientes de entrega.</p>'; return; }
    box.innerHTML = '';
    items.forEach(t => {
      const v = t.venta || {};
      const d = document.createElement('div');
      d.className = 'list-item';
      const tel = (v.telefono || t.telefono || '').replace(/\D/g, '');
      d.innerHTML = '<label class="check"><input type="checkbox" data-pend="' + esc(t.ventaId) + '"> <strong>' + esc(v.folio || t.ventaId) + '</strong> · ' + esc(v.clienteNombre || t.clienteNombre || '') + '</label>' +
        '<small>' + esc(v.tipoVenta || '') + ' · Total ' + money(v.totalManual) + ' · Saldo ' + money(v.saldo) + ' · ' + esc(v.estado || t.estado || '') + '</small>' +
        '<div class="row">' +
        (tel ? '<a class="btn btn-secondary" href="https://wa.me/52' + tel + '?text=' + encodeURIComponent('Hola, le avisamos de Boutique de Lentes Yael (Calle 4) que su trabajo ' + (v.folio || '') + ' ya está listo para recoger. ¡Gracias por su preferencia!') + '" target="_blank" rel="noopener">Avisar por WhatsApp</a>' : '<span class="hint">Sin teléfono para avisar.</span>') +
        '<button class="btn btn-secondary" type="button" data-open-venta="' + esc(t.ventaId) + '">Ver ficha</button></div>';
      box.appendChild(d);
    });
    $$('[data-pend]', box).forEach(cb => cb.onchange = () => { cb.checked ? state.pendientesSel.add(cb.dataset.pend) : state.pendientesSel.delete(cb.dataset.pend); });
    wireVentaButtons(box);
  } catch (e) { box.innerHTML = ''; showError('No se pudieron cargar los pendientes: ' + e.message); }
}
async function marcarEntregados() {
  if (!state.pendientesSel.size) { showError('Selecciona al menos un trabajo con el check.'); return; }
  try {
    await api('marcarEntregados', { ventaIds: Array.from(state.pendientesSel) });
    showOk('Trabajos marcados como entregados.', $('#pendMsg'));
    cargarPendientes();
  } catch (e) { showError('No se pudo marcar entregados: ' + e.message); }
}
async function cargarEnProceso() {
  const box = $('#procList');
  box.innerHTML = '<p class="hint">Cargando…</p>';
  try {
    const items = await api('getEnProceso');
    if (!items.length) { box.innerHTML = '<p class="hint">No hay trabajos en proceso.</p>'; return; }
    box.innerHTML = '';
    items.forEach(t => {
      const v = t.venta || {};
      const d = document.createElement('div');
      d.className = 'list-item';
      d.innerHTML = '<strong>' + esc(v.folio || t.ventaId) + '</strong> · ' + esc(v.clienteNombre || t.clienteNombre || '') +
        '<small>' + esc(v.tipoVenta || '') + ' · ' + esc(v.lenteMaterial || v.lcTipo || '') + ' ' + esc(v.lenteDiseno || '') + ' · ' + esc(v.armazonMaterial || '') + ' ' + esc(v.armazonDiseno || '') + '</small>' +
        '<div class="row"><button class="btn btn-primary" type="button" data-a-listo="' + esc(t.ventaId) + '">Pasar a pendiente de entrega</button>' +
        '<button class="btn btn-secondary" type="button" data-open-venta="' + esc(t.ventaId) + '">Ver ficha</button></div>';
      box.appendChild(d);
    });
    $$('[data-a-listo]', box).forEach(b => b.onclick = async () => {
      try { await api('cambiarEstadoTrabajo', { ventaId: b.dataset.aListo, estado: 'Pendiente de entrega' }); cargarEnProceso(); }
      catch (e) { showError('No se pudo cambiar el estado: ' + e.message); }
    });
    wireVentaButtons(box);
  } catch (e) { box.innerHTML = ''; showError('No se pudieron cargar los trabajos en proceso: ' + e.message); }
}

/* ---------- Resumen, gastos, fondo, corte de caja ---------- */
async function cargarResumen() {
  const box = $('#resumenData');
  const periodo = $('#resPeriodo').value;
  box.innerHTML = '<p class="hint">Cargando…</p>';
  try {
    const r = await api('getResumen', { periodo });
    const porMetodo = r.porMetodo || {};
    const vTot = (r.ventas && typeof r.ventas === 'object') ? r.ventas : { cantidad: r.ventas || 0, total: 0 };
    box.innerHTML = '<table><tr><th>Ventas (' + esc(periodo) + ')</th><td>' + esc(String(vTot.cantidad)) + ' · ' + money(vTot.total) + '</td></tr>' +
      '<tr><th>Cobrado</th><td>' + money(r.cobrado) + '</td></tr>' +
      Object.keys(porMetodo).map(m => '<tr><th>' + esc(m) + '</th><td>' + money(porMetodo[m]) + '</td></tr>').join('') +
      '<tr><th>Gastos</th><td>' + money(r.gastos) + '</td></tr>' +
      '<tr><th>Fondo de producción</th><td>' + money(r.fondo) + '</td></tr></table>';
    cargarGastos(r.desde, r.hasta);
  } catch (e) { box.innerHTML = ''; showError('No se pudo cargar el resumen: ' + e.message); }
}
/* Lista de gastos del mismo periodo del resumen. Usa getGastos (ya existe
   en el backend y en el contrato); el filtro por fecha se aplica también
   en el cliente porque el modo demo devuelve todos los gastos. */
async function cargarGastos(desde, hasta) {
  const box = $('#gastosData');
  if (!box) return;
  box.innerHTML = '<p class="hint">Cargando…</p>';
  try {
    const lista = await api('getGastos', { desde, hasta });
    const gastos = (lista || [])
      .filter(g => (!desde || String(g.fecha || '') >= desde) && (!hasta || String(g.fecha || '') <= hasta))
      .slice()
      .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
    if (!gastos.length) { box.innerHTML = '<p class="hint">Sin gastos en este periodo.</p>'; return; }
    const total = gastos.reduce((s, g) => s + (Number(g.monto) || 0), 0);
    box.innerHTML = '<table><tr><th>Fecha</th><th>Concepto</th><th>Método</th><th>Monto</th></tr>' +
      gastos.map(g => '<tr><td>' + fechaMX(g.fecha) + '</td><td>' + esc(g.concepto || '') + '</td><td>' + esc(g.metodo || '') + '</td><td>' + money(g.monto) + '</td></tr>').join('') +
      '<tr><td colspan="3"><strong>Total de gastos</strong></td><td><strong>' + money(total) + '</strong></td></tr></table>';
  } catch (e) { box.innerHTML = ''; showError('No se pudieron cargar los gastos: ' + e.message); }
}
async function cargarFondo() {
  const box = $('#fondoData');
  try {
    const f = await api('getFondo');
    box.innerHTML = '<p>Saldo del fondo: <strong>' + money(f.saldo) + '</strong></p>' +
      ((f.movimientos || []).slice(-5).reverse().map(m => '<p><small>' + fechaMX(m.fecha) + ' · ' + esc(m.tipo || '') + ' · ' + esc(m.concepto || '') + ' · ' + money(m.monto) + '</small></p>').join('') || '<p class="hint">Sin movimientos.</p>');
  } catch (e) { box.innerHTML = ''; showError('No se pudo cargar el fondo: ' + e.message); }
}
async function registrarGasto() {
  const fecha = $('#gastoFecha').value || hoyISO();
  const concepto = $('#gastoConcepto').value.trim();
  const monto = Number($('#gastoMonto').value || 0);
  if (!concepto || !(monto > 0)) { showError('Concepto y monto mayor a 0 son obligatorios.'); return; }
  try {
    await api('registrarGasto', { fecha, concepto, monto, metodo: $('#gastoMetodo').value, comprobante: $('#gastoComprobante').value.trim() });
    showOk('Gasto registrado.', $('#gastoMsg'));
    $('#gastoConcepto').value = ''; $('#gastoMonto').value = ''; $('#gastoComprobante').value = '';
    cargarResumen(); cargarFondo();
  } catch (e) { showError('No se pudo registrar el gasto: ' + e.message); }
}
async function registrarSalidaFondo() {
  const concepto = $('#fondoConcepto').value.trim();
  const monto = Number($('#fondoMonto').value || 0);
  if (!concepto || !(monto > 0)) { showError('Concepto y monto mayor a 0 son obligatorios.'); return; }
  try {
    const r = await api('registrarSalidaFondo', { concepto, monto });
    showOk('Salida registrada. Nuevo saldo del fondo: ' + money(r.saldo), $('#fondoMsg'));
    $('#fondoMsg').classList.remove('error'); $('#fondoMsg').classList.add('success');
    $('#fondoConcepto').value = ''; $('#fondoMonto').value = '';
    cargarFondo();
  } catch (e) { showError('No se pudo registrar la salida: ' + e.message, $('#fondoMsg')); }
}
async function cargarCorte() {
  const fecha = $('#corteFecha').value || hoyISO();
  try {
    const c = await api('getCorteCaja', { fecha });
    state.corteCache = c;
    const e = c.esperado || {};
    $('#corteData').innerHTML = '<table>' +
      '<tr><th>Efectivo esperado</th><td>' + money(e.efectivo) + '</td></tr>' +
      '<tr><th>Tarjeta</th><td>' + money(e.tarjeta) + '</td></tr>' +
      '<tr><th>Transferencia</th><td>' + money(e.transferencia) + '</td></tr>' +
      '<tr><th>Programas sociales</th><td>' + money(e.programasSociales) + '</td></tr>' +
      '<tr><th>Gastos del día</th><td>' + money(c.gastosDia) + '</td></tr>' +
      '<tr class="total-row"><th>Total en caja</th><td>' + money(c.totalCaja) + '</td></tr></table>';
    actualizarDiferencia();
  } catch (e2) { showError('No se pudo calcular el corte: ' + e2.message); }
}
function actualizarDiferencia() {
  if (!state.corteCache) return;
  const contado = Number($('#corteContado').value || 0);
  $('#corteDiferencia').textContent = money(contado - Number(state.corteCache.totalCaja || 0));
}
async function guardarCorte() {
  const fecha = $('#corteFecha').value || hoyISO();
  if (!state.corteCache) { showError('Primero calcula el corte del día.'); return; }
  const contado = Number($('#corteContado').value || 0);
  const diferencia = contado - Number(state.corteCache.totalCaja || 0);
  try {
    await api('guardarCorteCaja', { fecha, contado, diferencia });
    showOk('Corte de caja guardado. Diferencia: ' + money(diferencia), $('#corteMsg'));
  } catch (e) { showError('No se pudo guardar el corte: ' + e.message); }
}

/* ---------- Lista de materiales / Catálogos ---------- */
async function cargarMateriales() {
  const box = $('#matData');
  box.innerHTML = '<p class="hint">Cargando…</p>';
  try {
    const d = await api('getListaMateriales');
    state.materialesCache = d;
    box.innerHTML = '<h3>Micas pendientes</h3>' +
      ((d.micas || []).map(m => '<p><small><strong>' + esc(m.folio || '') + '</strong> · ' + esc(m.cliente || '') + ' · ' + esc(m.material || '') + ' ' + esc(m.diseno || '') + ' ' + esc(m.tratamiento || '') + ' · Prov. ' + esc(m.proveedor || '') + ' · Grad. OD Esf ' + esc((m.graduacion && m.graduacion.esfOD) || '—') + ' / OI Esf ' + esc((m.graduacion && m.graduacion.esfOI) || '—') + '</small></p>').join('') || '<p class="hint">Sin micas pendientes.</p>') +
      '<h3>Armazones pendientes (otra hoja)</h3>' +
      ((d.armazones || []).map(a => '<p><small><strong>' + esc(a.folio || '') + '</strong> · ' + esc(a.cliente || '') + ' · ' + esc(a.material || '') + ' ' + esc(a.diseno || '') + ' · ' + esc(a.modelo || '') + ' ' + esc(a.marca || '') + ' · Color ' + esc(a.color || '') + '</small></p>').join('') || '<p class="hint">Sin armazones pendientes.</p>');
  } catch (e) { box.innerHTML = ''; showError('No se pudo cargar la lista de materiales: ' + e.message); }
}
async function cargarCatalogosView() {
  const box = $('#catData');
  box.innerHTML = '<p class="hint">Cargando…</p>';
  try {
    const c = state.catalogs || await api('getCatalogos');
    state.catalogs = c;
    const sec = (titulo, filas) => '<h3>' + titulo + '</h3>' + (filas.length ? '<table>' + filas.map(f => '<tr><td>' + f.map(esc).join('</td><td>') + '</td></tr>').join('') + '</table>' : '<p class="hint">Vacío — se llena en el Google Sheet.</p>');
    box.innerHTML =
      sec('Catálogo de armazones (modelo, marca, material, diseño, precio definido)', (c.armazones || []).map(a => [a.modelo || a.Modelo || '', a.marca || a.Marca || '', a.material || a.Material || '', a.diseno || a.Diseno || '', a.precioDef || a.Precio_Def || ''])) +
      sec('Precios de lentes (micas, estimados)', (c.preciosLentes || []).map(p => [p.concepto || p.Concepto || '', money(p.precioEstimado || p.Precio_Estimado || 0)])) +
      sec('Costos de producción (servicios de laboratorio)', (c.costosProduccion || []).map(p => [p.servicio || p.Servicio || '', money(p.precio || p.Precio || 0)])) +
      sec('Conceptos: rebisel y accesorios', (c.conceptos || []).map(p => [p.concepto || p.Concepto || '', p.tipo || p.Tipo || '', 'Venta: ' + (p.costoVenta || p.Costo_Venta || '—'), 'Producción/adquisición: ' + (p.costoProduccion || p.Costo_Produccion || p.costoAdquisicion || p.Costo_Adquisicion || '—')])) +
      sec('Precios de lentes de contacto (por marca; precio real editable en el Sheet)', (c.preciosLC || []).map(p => [p.tipo || p.Tipo || '', p.marca || p.Marca || '', 'Sugerido: ' + money(p.precioSugerido || p.Precio_Sugerido || 0), 'Real: ' + (p.precioReal || p.Precio_Real || '—'), 'BC ' + (p.curvaBase || p.Curva_Base || '—') + ' · Ø ' + (p.diametro || p.Diametro || '—')]));
  } catch (e) { box.innerHTML = ''; showError('No se pudieron cargar los catálogos: ' + e.message); }
}

/* ---------- Ficha de venta: abonos y correcciones ---------- */
async function abrirFichaVenta(ventaId) {
  state.currentVentaId = ventaId;
  try {
    const d = await api('getVenta', { ventaId });
    const v = d.venta, c = d.cliente || {};
    state.currentVenta = v;
    state.currentHistoria = d.historia || null;
    $('#ventaFicha').innerHTML = '<div class="card"><h3>' + esc(v.folio || v.id) + ' · ' + esc(c.nombre || v.clienteNombre || '') + '</h3>' +
      '<p>' + fechaMX(v.fecha) + ' · ' + esc(v.tipoVenta || '') + ' · Estado: ' + esc(v.estado || '') + '</p>' +
      '<table><tr><th>Total</th><td>' + money(v.totalManual) + '</td></tr>' +
      '<tr><th>A cuenta</th><td>' + money(v.aCuenta) + '</td></tr>' +
      '<tr class="total-row"><th>Saldo</th><td>' + money(v.saldo) + '</td></tr></table>' +
      '<h4>Pagos</h4>' + ((d.pagos || v.pagos || []).map(p => '<p><small>' + fechaMX(p.fecha) + ' · ' + money(p.monto) + ' · ' + esc(p.metodo || '') + ' · ' + esc(p.concepto || '') + '</small></p>').join('') || '<p class="hint">Sin pagos registrados.</p>') +
      '<p><small>Graduación (solo informativa): OD Esf ' + esc((v.graduacion && v.graduacion.esfOD) || '—') + ' · OI Esf ' + esc((v.graduacion && v.graduacion.esfOI) || '—') + '</small></p></div>';
    show('venta');
  } catch (e) { showError('No se pudo abrir la ficha: ' + e.message); }
}
async function registrarAbono() {
  const monto = Number($('#abonoMonto').value || 0);
  if (!(monto > 0) || !state.currentVentaId) { showError('Captura un monto mayor a 0 y abre primero la ficha de la venta.'); return; }
  try {
    const r = await api('registrarAbono', { ventaId: state.currentVentaId, monto, metodo: $('#abonoMetodo').value, concepto: $('#abonoConcepto').value });
    showOk('Abono registrado. Nuevo saldo: ' + money(r.saldo), $('#abonoMsg'));
    $('#abonoMonto').value = '';
    abrirFichaVenta(state.currentVentaId);
  } catch (e) { showError('No se pudo registrar el abono: ' + e.message); }
}
async function registrarCorreccion() {
  const campo = $('#corrCampo').value;
  const nuevo = $('#corrNuevo').value.trim();
  const justif = $('#corrJustif').value.trim();
  if (!nuevo || !justif || !state.currentVentaId) { showError('El valor nuevo y la justificación son obligatorios.'); return; }
  // Valor anterior REAL, tomado de la ficha cargada (el histórico imborrable
  // debe guardar qué había antes, no un texto genérico).
  const mapaGrad = { Grad_Esf_OD: 'gradEsfOD', Grad_Cil_OD: 'gradCilOD', Grad_Eje_OD: 'gradEjeOD', Grad_Esf_OI: 'gradEsfOI', Grad_Cil_OI: 'gradCilOI', Grad_Eje_OI: 'gradEjeOI', Grad_Add: 'gradAdd', DNP: 'dnp' };
  const mapaPrecio = { Total_Manual: 'totalManual', Costo_Final_Inversion: 'costoFinalInversion' };
  let anterior = '';
  if (mapaGrad[campo] && state.currentHistoria) anterior = state.currentHistoria[mapaGrad[campo]];
  else if (mapaPrecio[campo] && state.currentVenta) anterior = state.currentVenta[mapaPrecio[campo]];
  if (anterior === undefined || anterior === null || anterior === '') anterior = 'no registrado';
  try {
    await api('corregir', { ventaId: state.currentVentaId, campo, valorAnterior: String(anterior), valorNuevo: nuevo, justificacion: justif, historiaId: (state.currentHistoria && state.currentHistoria.id) || undefined });
    showOk('Corrección registrada en el histórico imborrable.', $('#corrMsg'));
    $('#corrNuevo').value = ''; $('#corrJustif').value = '';
  } catch (e) { showError('No se pudo registrar la corrección: ' + e.message); }
}

/* ---------- Número a palabras (español, para el comprobante) ---------- */
const UNIDADES = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte'];
const DECENAS = ['', '', 'veinti', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
function centenas(n) {
  if (n === 0) return '';
  if (n === 100) return 'cien';
  let out = '';
  const c = Math.floor(n / 100), r = n % 100;
  if (c === 1) out = 'ciento';
  else if (c === 2) out = 'doscientos';
  else if (c === 3) out = 'trescientos';
  else if (c === 4) out = 'cuatrocientos';
  else if (c === 5) out = 'quinientos';
  else if (c === 6) out = 'seiscientos';
  else if (c === 7) out = 'setecientos';
  else if (c === 8) out = 'ochocientos';
  else if (c === 9) out = 'novecientos';
  if (r) {
    if (r <= 20) out += (out ? ' ' : '') + UNIDADES[r];
    else if (r < 30) out += (out ? ' ' : '') + 'veinti' + UNIDADES[r % 10];
    else {
      out += (out ? ' ' : '') + DECENAS[Math.floor(r / 10)];
      if (r % 10) out += ' y ' + UNIDADES[r % 10];
    }
  }
  return out;
}
function numeroALetras(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n === 0) return 'Cero pesos';
  let out = '';
  const miles = Math.floor(n / 1000), resto = n % 1000;
  if (miles === 1) out = 'mil';
  else if (miles > 1) out = centenas(miles) + ' mil';
  if (resto) out += (out ? ' ' : '') + centenas(resto);
  return out.charAt(0).toUpperCase() + out.slice(1) + ' pesos';
}

/* ---------- Documentos (vistas imprimibles) ---------- */
function docHead(titulo) {
  return '<div class="doc-head"><img src="logo.png" alt="Boutique de Lentes Yael"><div><div class="doc-title">' + esc(titulo) + '</div>' +
    '<div><strong>' + esc(NEGOCIO.nombre) + '</strong> · Sucursal ' + esc(NEGOCIO.sucursal) + '</div>' +
    '<div class="addr">' + esc(NEGOCIO.direccion) + ' · Tel. ' + esc(NEGOCIO.telefonos) + '</div></div></div>';
}
function rxTabla(g) {
  g = g || {};
  return '<table class="rx-table"><tr><th></th><th>Esf</th><th>Cil</th><th>Eje</th></tr>' +
    '<tr><td>O.D.</td><td>' + esc(g.esfOD || '—') + '</td><td>' + esc(g.cilOD || '—') + '</td><td>' + esc(g.ejeOD || '—') + '</td></tr>' +
    '<tr><td>O.I.</td><td>' + esc(g.esfOI || '—') + '</td><td>' + esc(g.cilOI || '—') + '</td><td>' + esc(g.ejeOI || '—') + '</td></tr></table>' +
    '<p>Add: ' + esc(g.add || '—') + ' · DNP: ' + esc(g.dnp || '—') + '</p>';
}
function docHistoriaHTML(d) {
  const v = d.venta || {}, c = d.cliente || {}, h = d.historia || v.historia || {};
  const g = v.graduacion || { esfOD: h.gradEsfOD, cilOD: h.gradCilOD, ejeOD: h.gradEjeOD, esfOI: h.gradEsfOI, cilOI: h.gradCilOI, ejeOI: h.gradEjeOI, add: h.gradAdd, dnp: h.dnp };
  return '<div class="doc doc-historia">' + docHead('Historia clínica') +
    '<div class="hc-grid"><div><strong>Paciente:</strong> ' + esc(c.nombre || v.clienteNombre || '') + '</div>' +
    '<div><strong>Fecha:</strong> ' + fechaMX(v.fecha || h.fecha) + '</div>' +
    '<div><strong>Edad:</strong> ' + esc(String(c.edad || '')) + ' años</div>' +
    '<div><strong>Sexo:</strong> ' + esc(c.sexo || '') + '</div>' +
    '<div><strong>Fecha de nacimiento:</strong> ' + fechaMX(c.fechaNac) + '</div>' +
    '<div><strong>Teléfono:</strong> ' + esc(c.telefono || v.telefono || '') + '</div>' +
    '<div><strong>Ocupación:</strong> ' + esc(c.ocupacion || '') + '</div>' +
    '<div><strong>¿Usa lentes?</strong> ' + esc(h.usaLentes || '') + '</div>' +
    '<div><strong>Motivo de consulta:</strong> ' + esc(h.motivo || '') + '</div>' +
    '<div><strong>Antecedentes:</strong> ' + [h.antDiabetes ? 'Diabetes' : '', h.antHipertension ? 'Hipertensión' : '', h.antMigrana ? 'Migraña' : ''].filter(Boolean).join(', ') + '</div></div>' +
    '<h3>Agudeza visual (Snellen)</h3><table><tr><th></th><th>O.D.</th><th>O.I.</th><th>A/O</th></tr>' +
    '<tr><td>Sin Rx</td><td>' + esc(h.avSinOD || '—') + '</td><td>' + esc(h.avSinOI || '—') + '</td><td>' + esc(h.avSinAO || '—') + '</td></tr>' +
    '<tr><td>Con Rx</td><td>' + esc(h.avConOD || '—') + '</td><td>' + esc(h.avConOI || '—') + '</td><td>' + esc(h.avConAO || '—') + '</td></tr></table>' +
    '<h3>Graduación del examen (refracción subjetiva)</h3>' + rxTabla(g) +
    '<p><strong>Diagnóstico refractivo:</strong> ' + esc(h.diagnostico || '') + '</p>' +
    '<p><strong>Indicaciones:</strong> ' + esc(h.indicaciones || '') + '</p>' +
    '<p><strong>Recomendación:</strong> ' + esc(h.recomendacion || '') + '</p>' +
    '<div class="sig"><div>Firma del paciente</div><div>Firma del optometrista</div></div></div>';
}
function docOrdenHTML(d) {
  const v = d.venta || {}, c = d.cliente || {};
  const g = v.graduacion || {};
  const etiqueta = '<div class="orden-label"><h4>' + esc(NEGOCIO.nombre) + ' · ' + esc(v.folio || v.id || '') + '</h4>' +
    '<div>' + esc(c.nombre || v.clienteNombre || '') + ' · ' + fechaMX(v.fecha) + ' · ' + esc(String(c.edad || '')) + ' años</div>' +
    '<table><tr><th></th><th>Esf</th><th>Cil</th><th>Eje</th></tr>' +
    '<tr><td>O.D.</td><td>' + esc(g.esfOD || '—') + '</td><td>' + esc(g.cilOD || '—') + '</td><td>' + esc(g.ejeOD || '—') + '</td></tr>' +
    '<tr><td>O.I.</td><td>' + esc(g.esfOI || '—') + '</td><td>' + esc(g.cilOI || '—') + '</td><td>' + esc(g.ejeOI || '—') + '</td></tr></table>' +
    '<div>Add ' + esc(g.add || '—') + ' · DNP ' + esc(g.dnp || '—') + '</div>' +
    '<div>Diseño: ' + esc(v.lenteDiseno || v.lcTipo || '') + ' · Material: ' + esc(v.lenteMaterial || '') + '</div>' +
    '<div>Tratamiento: ' + esc(v.lenteTratamiento || '') + ' · Prov. ' + esc(v.lenteProveedor || '') + '</div>' +
    '<div>Armazón: ' + esc(v.armazonMaterial || '') + ' ' + esc(v.armazonDiseno || '') + ' · ' + esc(v.armazonModelo || '') + ' · Color ' + esc(v.armazonColor || '') + '</div></div>';
  return '<div class="doc"><div class="doc-head"><img src="logo.png" alt="Boutique de Lentes Yael"><div><div class="doc-title">Orden de trabajo</div><div class="addr">' + esc(NEGOCIO.direccion) + ' · Tel. ' + esc(NEGOCIO.telefonos) + '</div></div></div>' +
    '<p class="hint">9 etiquetas por hoja (A8 / 1/16 de carta). Se imprime la misma etiqueta 9 veces para cortar.</p>' +
    '<div class="doc-orden-grid">' + etiqueta.repeat(9) + '</div></div>';
}
function docTicketHTML(d) {
  const v = d.venta || {}, c = d.cliente || {};
  const filas = [];
  if (v.armazonMaterial) filas.push(['ARMAZÓN — ' + v.armazonMaterial + ' / ' + v.armazonDiseno, money(v.armazonPrecioDef)]);
  if (v.lenteMaterial) filas.push(['LENTE — ' + v.lenteMaterial + ' ' + v.lenteDiseno + ' ' + v.lenteTratamiento, money(v.lentePrecioDef)]);
  if (v.lcTipo) filas.push(['LENTE DE CONTACTO — ' + v.lcTipo + ' ' + v.lcMarca + ' (caja de 6)', money(v.lcPrecioDef)]);
  if (v.tipoVenta === 'rebisel') filas.push(['REBISEL — ' + (v.rebiselConcepto || ''), money(v.armazonPrecioDef)]);
  if (v.tipoVenta === 'accesorio') filas.push(['ACCESORIO — ' + (v.accesorioDesc || ''), money(v.armazonPrecioDef)]);
  // La graduación NO aparece en el ticket.
  return '<div class="doc doc-ticket"><div class="center"><img src="logo.png" alt="Boutique de Lentes Yael" style="width:120px;height:auto"></div>' +
    '<h2>' + esc(NEGOCIO.nombre) + '</h2><p>' + esc(NEGOCIO.direccion) + '<br>Tel. ' + esc(NEGOCIO.telefonos) + '</p><hr>' +
    '<p>COMPROBANTE DE VENTA<br>' + esc(v.folio || v.id || '') + '</p>' +
    '<p>Cliente: ' + esc(c.nombre || v.clienteNombre || '') + '<br>ID ' + esc(c.id || '') + ' · Fecha ' + fechaMX(v.fecha) + '</p><hr>' +
    '<table>' + filas.map(f => '<tr><td>' + esc(f[0]) + '</td><td>' + f[1] + '</td></tr>').join('') + '</table><hr>' +
    '<table><tr><td>TOTAL</td><td>' + money(v.totalManual) + '</td></tr>' +
    '<tr><td>Pagado</td><td>' + money(v.aCuenta) + '</td></tr>' +
    '<tr><td>Saldo</td><td>' + money(v.saldo) + '</td></tr>' +
    '<tr><td>Estado</td><td>' + esc(v.saldo > 0 ? 'PENDIENTE' : 'LIQUIDADO') + '</td></tr></table><hr>' +
    '<p>Gracias por su preferencia</p></div>';
}
function docComprobanteHTML(d) {
  const v = d.venta || {}, c = d.cliente || {};
  const prox = new Date(v.fecha || hoyISO());
  prox.setMonth(prox.getMonth() + PROXIMA_VISITA_MESES);
  // La graduación NO aparece en el comprobante.
  return '<div class="doc doc-comprobante">' +
    '<div class="banner-top"><img src="logo.png" alt="Boutique de Lentes Yael" style="width:140px;height:auto;background:#fff;border-radius:8px;padding:4px"><div style="text-align:right"><div class="doc-title" style="color:#fff">Comprobante de venta</div><div>PEDIDO No. ' + esc(v.folio || v.id || '') + '</div><div>FECHA ' + fechaMX(v.fecha) + '</div></div></div>' +
    '<p><strong>Nombre:</strong> ' + esc(c.nombre || v.clienteNombre || '') + ' &nbsp; <strong>Móvil:</strong> ' + esc(c.telefono || v.telefono || '') + '</p>' +
    '<table><tr><th>Concepto</th><th>Detalle</th><th>Precio</th></tr>' +
    (v.armazonMaterial ? '<tr><td>Armazón</td><td>' + esc(v.armazonMaterial) + ' ' + esc(v.armazonDiseno) + ' · Modelo ' + esc(v.armazonModelo || '') + ' · Marca ' + esc(v.armazonMarca || '') + ' · Color ' + esc(v.armazonColor || '') + '</td><td>' + money(v.armazonPrecioDef) + '</td></tr>' : '') +
    (v.lenteMaterial ? '<tr><td>Lente</td><td>' + esc(v.lenteMaterial) + ' ' + esc(v.lenteDiseno) + ' · ' + esc(v.lenteTratamiento || '') + ' · Proveedor ' + esc(v.lenteProveedor || '') + '</td><td>' + money(v.lentePrecioDef) + '</td></tr>' : '') +
    (v.lcTipo ? '<tr><td>Lente de contacto</td><td>' + esc(v.lcTipo) + ' · ' + esc(v.lcMarca || '') + ' · Caja de 6 lentes · Reemplazo mensual · BC ' + esc(v.lcCurvaBase || '') + ' · Ø ' + esc(v.lcDiametro || '') + '</td><td>' + money(v.lcPrecioDef) + '</td></tr>' : '') +
    (v.tipoVenta === 'rebisel' ? '<tr><td>Rebisel</td><td>' + esc(v.rebiselConcepto || '') + '</td><td>' + money(v.armazonPrecioDef) + '</td></tr>' : '') +
    (v.tipoVenta === 'accesorio' ? '<tr><td>Accesorio</td><td>' + esc(v.accesorioDesc || '') + '</td><td>' + money(v.armazonPrecioDef) + '</td></tr>' : '') +
    '<tr><td>Total parcial</td><td></td><td>' + money(v.precioDefTotal) + '</td></tr>' +
    '<tr><td>Descuento</td><td></td><td>' + money(v.descuento) + '</td></tr>' +
    '<tr class="total-row"><td>Neto / Total</td><td></td><td>' + money(v.totalManual) + '</td></tr>' +
    '<tr><td>Anticipo / A cuenta</td><td></td><td>' + money(v.aCuenta) + '</td></tr>' +
    '<tr><td>Saldo</td><td></td><td>' + money(v.saldo) + '</td></tr></table>' +
    '<p><strong>Cantidad total en palabras:</strong> ' + esc(numeroALetras(v.totalManual)) + ' MXN.</p>' +
    '<div class="garantias"><strong>Garantías:</strong> ' + esc(GARANTIAS.adaptacion) + ' · ' + esc(GARANTIAS.armazon) + ' · ' + esc(GARANTIAS.tratamiento) + '.<br><strong>Próxima visita:</strong> ' + prox.toLocaleDateString('es-MX') + ' (10 meses).</div>' +
    '<div class="sig"><div>Firma del cliente</div><div>Boutique de Lentes Yael</div></div></div>';
}
function docMaterialesHTML(d) {
  const micas = (d && d.micas) || [];
  const armazones = (d && d.armazones) || [];
  return '<div class="doc">' + docHead('Lista de materiales') +
    '<h3>Micas pendientes de realizar</h3>' +
    (micas.length ? '<table><tr><th>Folio</th><th>Cliente</th><th>Graduación OD / OI</th><th>Material</th><th>Diseño</th><th>Tratamiento</th><th>Proveedor</th></tr>' +
      micas.map(m => '<tr><td>' + esc(m.folio || '') + '</td><td>' + esc(m.cliente || '') + '</td><td>OD Esf ' + esc((m.graduacion && m.graduacion.esfOD) || '—') + ' Cil ' + esc((m.graduacion && m.graduacion.cilOD) || '—') + ' Eje ' + esc((m.graduacion && m.graduacion.ejeOD) || '—') + '<br>OI Esf ' + esc((m.graduacion && m.graduacion.esfOI) || '—') + ' Cil ' + esc((m.graduacion && m.graduacion.cilOI) || '—') + ' Eje ' + esc((m.graduacion && m.graduacion.ejeOI) || '—') + '</td><td>' + esc(m.material || '') + '</td><td>' + esc(m.diseno || '') + '</td><td>' + esc(m.tratamiento || '') + '</td><td>' + esc(m.proveedor || '') + '</td></tr>').join('') + '</table>' : '<p class="hint">Sin micas pendientes.</p>') +
    '<h3 style="page-break-before:always">Armazones pendientes (otra hoja)</h3>' +
    (armazones.length ? '<table><tr><th>Folio</th><th>Cliente</th><th>Material</th><th>Diseño</th><th>Modelo</th><th>Marca</th><th>Color</th></tr>' +
      armazones.map(a => '<tr><td>' + esc(a.folio || '') + '</td><td>' + esc(a.cliente || '') + '</td><td>' + esc(a.material || '') + '</td><td>' + esc(a.diseno || '') + '</td><td>' + esc(a.modelo || '') + '</td><td>' + esc(a.marca || '') + '</td><td>' + esc(a.color || '') + '</td></tr>').join('') + '</table>' : '<p class="hint">Sin armazones pendientes.</p>') + '</div>';
}
async function abrirDoc(kind, ventaId, extra) {
  extra = extra || {};
  let data = null;
  try {
    if (kind === 'materiales') {
      data = state.materialesCache || await api('getListaMateriales');
    } else if (ventaId) {
      data = await api('getVenta', { ventaId });
    } else if (extra.historiaId && extra.clienteId) {
      const exp = await api('getLibroVisitas', { clienteId: extra.clienteId });
      const h = (exp.historias || []).find(x => x.id === extra.historiaId) || (exp.historias || [])[0] || {};
      data = { venta: (exp.ventas || [])[0] || {}, cliente: exp.cliente, historia: h };
    } else if (state.currentVentaId) {
      data = await api('getVenta', { ventaId: state.currentVentaId });
    } else {
      showError('Abre primero la ficha de una venta para ver sus documentos.');
      return;
    }
  } catch (e) { showError('No se pudo cargar el documento: ' + e.message); return; }
  const builders = { historia: docHistoriaHTML, orden: docOrdenHTML, ticket: docTicketHTML, comprobante: docComprobanteHTML, materiales: docMaterialesHTML };
  $('#docArea').innerHTML = (builders[kind] || docHistoriaHTML)(data);
  state.currentDoc = { kind, venta: data.venta || null, cliente: data.cliente || null };
  const shareBtn = $('#btnDocCompartir');
  shareBtn.hidden = !(kind === 'ticket' || kind === 'comprobante');
  show('doc');
}
async function compartirDoc() {
  const doc = state.currentDoc;
  if (!doc) return;
  const v = doc.venta || {};
  const c = doc.cliente || {};
  const texto = 'Boutique de Lentes Yael (Calle 4) — ' + (doc.kind === 'ticket' ? 'Ticket' : 'Comprobante de venta') + ' ' + (v.folio || '') +
    ' · Cliente: ' + (c.nombre || v.clienteNombre || '') + ' · Total: ' + money(v.totalManual) + ' · Pagado: ' + money(v.aCuenta) + ' · Saldo: ' + money(v.saldo) +
    (v.saldo > 0 ? ' · Pendiente de liquidar al recoger.' : ' · Liquidado. ¡Gracias por su preferencia!');
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Boutique de Lentes Yael', text: texto });
      return;
    }
    throw new Error('share no disponible');
  } catch (e) {
    const tel = (c.telefono || v.telefono || '').replace(/\D/g, '');
    const url = tel ? 'https://wa.me/52' + tel + '?text=' + encodeURIComponent(texto) : 'https://wa.me/?text=' + encodeURIComponent(texto);
    window.open(url, '_blank');
  }
}

/* ---------- Configuración inicial ---------- */
function loadConfig() {
  state.url = localStorage.getItem(LS_URL) || '';
  state.token = localStorage.getItem(LS_TOKEN) || '';
  state.demo = localStorage.getItem(LS_DEMO) === '1';
  $('#modeBadge').hidden = !state.demo;
}
function saveConfig(url, token, demoFlag) {
  if (demoFlag) {
    localStorage.setItem(LS_DEMO, '1');
    localStorage.removeItem(LS_URL);
    localStorage.removeItem(LS_TOKEN);
  } else {
    localStorage.setItem(LS_URL, url);
    localStorage.setItem(LS_TOKEN, token);
    localStorage.removeItem(LS_DEMO);
  }
  loadConfig();
}
async function entrarApp() {
  if (state.demo || (state.url && state.token)) {
    try {
      await api('ping');
    } catch (e) {
      showError('No se pudo conectar con el backend: ' + e.message + ' Revisa la URL y el token en Configuración.');
      show('setup');
      return;
    }
    await loadCatalogs();
    show('home');
  } else {
    show('setup');
  }
}

/* ---------- Inicio y eventos ---------- */
function init() {
  loadConfig();
  // Configuración
  $('#formSetup').addEventListener('submit', async ev => {
    ev.preventDefault();
    const url = $('#setupUrl').value.trim();
    const token = $('#setupToken').value.trim();
    if (!url || !token) { const e = $('#setupError'); e.textContent = 'Captura la URL del web app y el token.'; e.hidden = false; return; }
    saveConfig(url, token, false);
    entrarApp();
  });
  $('#btnEnterDemo').addEventListener('click', () => { saveConfig('', '', true); entrarApp(); });
  $('#setupDemo').addEventListener('change', ev => { if (ev.target.checked) { $('#setupUrl').required = false; $('#setupToken').required = false; } });
  $('#btnConfig').addEventListener('click', () => show('setup'));
  $('#btnHome').addEventListener('click', goHome);
  // Dashboard
  $$('#dashboardGrid [data-nav]').forEach(b => b.addEventListener('click', () => show(b.dataset.nav)));
  $$('[data-nav]').forEach(b => { if (!b.closest('#dashboardGrid')) b.addEventListener('click', () => show(b.dataset.nav)); });
  // Wizard
  $('#btnWizardNext').addEventListener('click', wizardNext);
  $('#btnWizardBack').addEventListener('click', wizardBack);
  $('#btnNvBuscar').addEventListener('click', buscarClienteNv);
  $('#nvBuscar').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); buscarClienteNv(); } });
  $('#btnNvCrearCliente').addEventListener('click', crearClienteNv);
  $('#nvFechaNac').addEventListener('change', ev => { $('#nvEdad').value = edadDesde(ev.target.value) + ' años'; });
  $('#hcUsaLentes').addEventListener('change', ev => {
    $('#hcLensometria').hidden = ev.target.value !== 'sí';
    $('#hcMotivoWrap').hidden = ev.target.value !== 'no';
  });
  $$('input[name="tipoVenta"]').forEach(r => r.addEventListener('change', aplicarTipoVenta));
  $('#lcConArmazon').addEventListener('change', aplicarTipoVenta);
  $('#lcTipo').addEventListener('change', actualizarMarcasLC);
  $('#lcMarca').addEventListener('change', actualizarMarcasLC);
  $('#lenteTratamiento').addEventListener('change', ev => { $('#filtroTonoWrap').hidden = ev.target.value !== 'Filtro color'; });
  $('#lenteConcepto').addEventListener('change', ev => {
    const m = ev.target.value.match(/\$([\d.,]+)/);
    if (m) $('#lentePrecio').value = m[1].replace(/,/g, '');
  });
  ['#pTotalManual', '#pACuenta'].forEach(s => $(s).addEventListener('input', actualizarPrecios));
  $('#pLiquidar').addEventListener('change', ev => {
    if (ev.target.checked) $('#pACuenta').value = $('#pTotalManual').value;
    actualizarPrecios();
  });
  $('#btnGuardarVenta').addEventListener('click', guardarVenta);
  $$('#docsAfterSave [data-doc]').forEach(b => b.addEventListener('click', () => abrirDoc(b.dataset.doc, state.currentVentaId)));
  // Buscar cliente / libro de visitas
  $('#btnBcBuscar').addEventListener('click', () => buscarClientes($('#bcBuscar').value.trim(), $('#bcResultados'), mostrarFichaCliente));
  $('#btnLvBuscar').addEventListener('click', () => buscarClientes($('#lvBuscar').value.trim(), $('#lvResultados'), mostrarExpediente));
  // Pendientes / en proceso
  $('#btnMarcarEntregados').addEventListener('click', marcarEntregados);
  // Resumen
  $('#btnResCargar').addEventListener('click', cargarResumen);
  $('#btnGasto').addEventListener('click', registrarGasto);
  $('#btnFondoSalida').addEventListener('click', registrarSalidaFondo);
  $('#btnCorteCargar').addEventListener('click', cargarCorte);
  $('#corteContado').addEventListener('input', actualizarDiferencia);
  $('#btnCorteGuardar').addEventListener('click', guardarCorte);
  // Materiales / catálogos
  $('#btnMatCargar').addEventListener('click', cargarMateriales);
  $('#btnCatCargar').addEventListener('click', cargarCatalogosView);
  // Ficha de venta
  $('#btnAbono').addEventListener('click', registrarAbono);
  $('#btnCorregir').addEventListener('click', registrarCorreccion);
  $$('#view-venta [data-doc]').forEach(b => b.addEventListener('click', () => abrirDoc(b.dataset.doc, state.currentVentaId)));
  $$('#view-lista-materiales [data-doc]').forEach(b => b.addEventListener('click', () => abrirDoc(b.dataset.doc, null)));
  // Documentos
  $('#btnDocVolver').addEventListener('click', () => show(state.currentVentaId ? 'venta' : 'home'));
  $('#btnDocImprimir').addEventListener('click', () => window.print());
  $('#btnDocCompartir').addEventListener('click', compartirDoc);
  // Valores iniciales del wizard
  aplicarTipoVenta();
  entrarApp();
  // Service worker (PWA instalable)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* sin SW la app sigue funcionando en línea */ });
  }
}
document.addEventListener('DOMContentLoaded', init);
