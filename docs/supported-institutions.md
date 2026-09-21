# Instituciones compatibles / Supported institutions

Actualizado / Updated: 2026-09-20.

[Español](#español) · [English](#english)

## Español

Esta lista describe la compatibilidad implementada en el repositorio. La versión
instalada desde Chrome Web Store puede tener funciones diferentes; publicar
código en GitHub no actualiza automáticamente la versión de la tienda.

### Colombia (CO)

| Institución | Producto | Descargar CSV/JSON y copiar | Periodo consultable | Enviar a Clatri |
| --- | --- | --- | --- | --- |
| Bancolombia | Cuenta de ahorros | Implementado | Rango de fechas seleccionado, cuando el portal permite aplicarlo | Pendiente |
| Bancolombia | Tarjeta de crédito | Implementado | Movimientos que ofrece el banco; sin filtro de fechas en este conector | Pendiente |
| Bancolombia | Cuenta corriente | Tipo reconocido por el adaptador; pendiente de validación específica | No confirmado para este producto | Pendiente |

**Cómo usarlo:** inicia sesión tú mismo en el portal de personas de Bancolombia,
abre **Tus productos** y luego la cuenta o tarjeta. Abre el panel flotante de
Clatri, selecciona el producto y descarga o copia los movimientos disponibles.

**Límites actuales:**

- La sesión del banco debe estar activa en el navegador. Iniciar sesión en Clatri
  es un paso independiente y no conecta por sí solo una institución.
- La exportación se cancela si la captura queda incompleta; no se genera un
  archivo parcial que parezca completo.
- La moneda base del conector es COP. Si el banco entrega una moneda explícita
  para un movimiento, se conserva; todavía no hay conversión histórica de
  divisas ni conciliación completa de importe original e importe facturado.
- La sincronización de movimientos con Clatri y su procesamiento automático aún
  no están habilitados. La columna «Enviar a Clatri» cambiará cuando se implementen.
- La compatibilidad depende del portal y puede cambiar cuando el banco lo
  actualiza. Esta lista no implica una integración oficial o una afiliación con
  la institución.

### Otros países e instituciones

Todavía no hay otros conectores implementados en este repositorio. Que una
institución no aparezca aquí significa que su compatibilidad no está confirmada.

### Contribuir

Puedes añadir instituciones y países siguiendo la [guía de contribución](../CONTRIBUTING.md).
Incluye el adaptador, los dominios necesarios y pruebas con datos ficticios;
actualiza esta lista con los productos y limitaciones que hayas comprobado.
No adjuntes contraseñas, cookies, tokens ni movimientos personales.

[Ver el repositorio en GitHub](https://github.com/gurwi-corp/clatri-extension) ·
[Reportar un problema](https://github.com/gurwi-corp/clatri-extension/issues)

## English

This list describes support implemented in this repository. The Chrome Web Store
release may differ: publishing code on GitHub does not update the store release.

### Colombia (CO)

| Institution | Product | Download CSV/JSON and copy | Available period | Send to Clatri |
| --- | --- | --- | --- | --- |
| Bancolombia | Savings account | Implemented | Selected date range, when the portal allows it to be applied | Pending |
| Bancolombia | Credit card | Implemented | Transactions offered by the bank; no date filter in this connector | Pending |
| Bancolombia | Checking account | Type recognized by the adapter; product-specific validation pending | Not confirmed for this product | Pending |

**How to use it:** sign in to Bancolombia’s personal banking portal yourself,
open **Tus productos**, then the account or card. Open Clatri’s floating panel,
select the product and download or copy the available transactions.

**Current limitations:**

- Your bank session must be active in the browser. Signing in to Clatri is
  separate and does not connect an institution by itself.
- Incomplete captures cancel the export; no misleading partial file is created.
- The connector’s base currency is COP. Explicit transaction currencies from the
  bank are preserved. Historical FX and full original/billed amount reconciliation
  are not implemented yet.
- Sending transactions to Clatri and automatic processing are not enabled yet.
  The “Send to Clatri” column will change when these capabilities are implemented.
- Support depends on the bank portal and may change when it is updated. This list
  does not imply an official integration or affiliation with the institution.

### Other countries and institutions

No other connectors are implemented in this repository yet. Institutions not
listed here do not have confirmed support.

### Contribute

Follow the [contribution guide](../CONTRIBUTING.md) to add institutions and countries.
Include an adapter, the required domains and tests using synthetic data; update
this list with the products and limitations you verified. Never attach passwords,
cookies, tokens or personal transactions.

[GitHub repository](https://github.com/gurwi-corp/clatri-extension) ·
[Report an issue](https://github.com/gurwi-corp/clatri-extension/issues)

---

Implementation references / Referencias de implementación:
[bank catalog](../src/core/registry.js),
[Bancolombia adapter](../src/banks/co-bancolombia.js),
[capture engine](../src/core/engine.js),
[CSV/JSON exporter](../src/core/export.js).
