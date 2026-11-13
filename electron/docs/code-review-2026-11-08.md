# Logic review — November 8, 2026

## Scope

Reviewed the Electron main/preload bridge, shared localStorage data layer, order creation/editing/copying, CSV/JSON import, monthly billing/statistics, print/image output, XLSX generation, and routing. Also inspected the Android bridge and file provider. Implemented the fixes below in the shared frontend and Electron source.

The working tree already contained changes to the 3D scene, styling, several views, preview scripts, and the Electron exception handler. Those existing changes were retained. No production profile or business records were used for tests. The existing APK was not rebuilt.

## Fixed findings

| Priority | Problem and effect | Correction |
| --- | --- | --- |
| P1 | **Copy as new overwrote the source order.** The copied draft retained its original `id`, so saving called `updateOrder`. | Clear the ID and timestamps and allocate a new number. A renderer test verifies that the source order is byte-for-byte unchanged. |
| P1 | **Failed writes appeared successful.** `persist()` swallowed storage exceptions, and a multi-key restore could leave mixed old/new data. | Report and throw write errors, roll back completed writes and cached values, and group order/product/customer/price updates into one synchronous transaction. The editor remains open for retry on failure. |
| P1 | **Malformed JSON backups could destroy usable data.** Validation checked only collection types; primitive `data`, null records, duplicate IDs, missing item arrays, and string totals were accepted. | Validate the supported version, data object, records, identities, dates, numeric fields, settings, prices, and sequences before changing any state. |
| P1 | **Saving silently discarded invalid lines and accepted invalid amounts.** Lines with zero/negative quantities disappeared while other lines saved; overflow could serialize numeric values as `null`. | Reject the entire save for invalid lines, negative prices, non-finite numbers, and amounts beyond the supported safe-cent range. Validate item-dialog input and delivery dates. |
| P2 | **Items could keep the wrong product ID or price history.** Renaming an item resurrected its previous ID; manual matching ignored specification; prices were remembered before new product/customer IDs existed. | Clear the selected ID when the name/specification changes, match both name and specification, and remember prices after all identities are resolved. |
| P2 | **CSV imports skipped valid variants.** Deduplication used only the name, so a different size of the same product was lost. Imports also persisted one row at a time. | Deduplicate by normalized name/specification and barcode, then persist the batch together. Barcode lookup was added to product search. |
| P2 | **Sequence restoration could create duplicate order numbers.** A backup without `seqMap` restarted at 001; reclamation recognized exactly three digits and could reclaim a live number. | Derive the lower bound from existing order numbers, accept sequences of at least three digits, and refuse reclamation while the number is in use. |
| P2 | **New-order numbers did not follow the selected date.** Changing the date left the number containing the original date. | Update the displayed/allocated number when a new draft's date changes. Existing saved orders retain their number when edited. |
| P2 | **Some monthly XLSX exports had invalid or duplicate sheet names.** Customer names were copied directly and truncated independently. | Sanitize names, provide defaults, and allocate unique names ignoring case, including collisions after truncation. |
| P2 | **Valid names could break aggregation.** Names/IDs such as `constructor` or `__proto__` collided with inherited object properties in statistics or monthly groups. | Use dictionaries with no prototype for those aggregations. |
| P2 | **Print and image output lost product specifications.** The detail view stored/showed the specification, but both output paths printed only the name. | Include the specification in the existing product-name column in both HTML and canvas output. |
| P2 | **Electron could turn a corrupt UTF-8 file into garbled imported text.** Unlike the browser and Android decoders, it retried GB18030 even when a UTF-8 BOM identified the encoding. | Reject corrupt BOM-marked UTF-8 files instead of changing encodings. |

## Verification

Run from `electron/`:

```powershell
npm test
npm run test:ui
```

- **12 Node regression tests passed**, covering backup validation/round trips, failed writes and restore rollback, transaction rollback, import batching and identity, sequence allocation/reclamation, XLSX names, barcode search, and Electron decoding.
- **9 Electron renderer scenarios passed**, exercising copy, specification/product matching, date/number behavior, rename, validation, failed-save retry, print/image content, and statistics/billing grouping.
- The existing `docs/3d-background/scripts/verify-bg3d.cjs` suite passed **all 37 checks**, including live Store data, category navigation, rendering, pause/resume, and preview compatibility.
- All 15 first-party shared frontend JavaScript files and the Electron/test entrypoints passed syntax checks.
- `git diff --check` passed for the edited source files.

Renderer tests create a separate temporary Electron profile. They do not open native save/print dialogs, exercise Android device permissions, build an installer/APK, or prove that every possible workflow is error-free.

## Recommendations and remaining limits

1. **Move durable business data to a transactional store.** The new rollback handles observed write exceptions, but six localStorage keys cannot provide crash/power-loss atomicity. The loader also still substitutes defaults for unreadable JSON; a recovery screen that preserves and exposes damaged raw records would be safer. Keep regular JSON backups while planning IndexedDB or SQLite.
2. **Define monetary precision centrally.** Several views still calculate with floating-point multiplication and `Math.round(value * 100)`. Specify supported quantity/price precision and use a shared decimal or fixed-point calculation routine before supporting more complex financial cases.
3. **Make image backups portable.** Product images are stored as absolute paths and JSON backups do not include image files. Restoring JSON on another machine does not migrate images. A future archive should include images with relative references, and the migration instructions should make this limitation explicit.
4. **Review navigation and draft retention.** The custom Android back stack is separate from browser history, and unsaved drafts have no general leave-page confirmation. Add tests mixing browser Back with Android Back and navigating away during editing before extending this behavior.
5. **Add native bridge/device coverage.** Check Android 6–9 download permission handling, WebView file/image picking, monthly-bill printing, and share-provider URI/path restrictions. Electron's isolated renderer suite does not validate those platform behaviors. Also cover native save cancellation and printer errors instead of relying on immediate frontend success toasts.
6. **Guard concurrent writers.** Each app instance caches the full data set. Add a single-instance policy or explicit cross-window data coordination before allowing multiple desktop instances to edit the same profile.

These are follow-up recommendations; they are not claimed as fixes completed by this patch.
