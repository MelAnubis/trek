// Carga los dibujos propios (app/data/dibujos) antes de los tests, como hace la app al abrir.
import { loadDrawings } from '../app/js/illustrations.js';
await loadDrawings(new URL('../app/data/dibujos/', import.meta.url));
