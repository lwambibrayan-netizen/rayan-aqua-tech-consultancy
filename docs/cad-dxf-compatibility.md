# AquaCAD DXF interoperability

## Exchange contract

- Export format: ASCII DXF, AutoCAD 2000 / DXF R2000 (AC1015).
- Drawing units: $INSUNITS is written from the project calibration. On import, recognized $INSUNITS values are detected when the project has no explicit calibration; an explicit project calibration takes precedence and a mismatch is reported.
- Geometry remains in drawing coordinates. Annotation coordinates/heights are converted using the effective metres-per-drawing-unit calibration.
- Exported entity records include R2000 subclass markers, unique handles, table-record handles, and a handseed.
- Layer export includes colour, linetype, lineweight, visibility, lock and plot state. Supported linetypes are CONTINUOUS, DASHED, CENTER, HIDDEN and PHANTOM.
- Closed polylines are exported with the closed flag; polyline bulges are retained.

## Supported import/export behavior

| DXF content | AquaCAD behavior |
|---|---|
| LINE, CIRCLE, LWPOLYLINE | Import/export as editable geometry |
| Legacy POLYLINE / VERTEX | Import as editable polyline, including bulges and closure |
| ARC | Import as a bulged polyline segment |
| TEXT, MTEXT | Import as editable text annotation; export as TEXT |
| DIMENSION | Import definition points and displayed override; export dimension graphics as linework and text |
| Nested BLOCK / INSERT | Recursively expand block primitives using insertion point, scale and rotation; detect cycles and enforce a depth limit |
| SPLINE | Import as sampled editable polyline; exact NURBS definition is not retained |
| ELLIPSE | Import as sampled editable polyline; exact analytic ellipse is not retained |
| Polyline-boundary HATCH | Import boundary only; hatch fill/pattern is not retained |
| SOLID, TRACE, 3DFACE | Import 2D boundary; Z/elevation is not retained |
| XREF, MINSERT arrays, unsupported entities | XREFs are skipped; MINSERT arrays are reduced to the first cell; unsupported entities are skipped with warnings where detected |

## Explicit limitations

- Binary DXF is not supported by the current text-pair reader; use ASCII DXF export from the source CAD application.
- Native DWG read/write is not provided. Use DXF for exchange.
- Dimension annotations are visually represented on export, not preserved as fully associative native dimension objects.
- Block INSERTs are exploded to editable primitives; MINSERT arrays are reduced to their first cell, and block definitions/attributes and parametric engineering-object identity are not round-tripped.
- Unsupported or approximated entities must be reviewed before engineering use.

## Verification record

The development branch was tested using the independent ezdxf 1.4.5 implementation:

1. AquaCAD generated a DXF R2000 (AC1015) file with metric millimetre units, line, circle, closed polyline, text, layers and dimension graphics. ezdxf opened it and audited it with zero errors and zero fixes.
2. A separate R2010 (AC1024) DXF created by ezdxf with millimetre units, line, circle, closed polyline, text and a nested, transformed block INSERT was imported by AquaCAD. It produced five editable shapes, one text annotation, detected 0.001 metres per drawing unit, and no import warnings.
3. The imported external drawing was exported again by AquaCAD and reopened/audited by ezdxf; the round-trip file had zero audit errors and zero audit fixes.

This is independent parser-level interoperability evidence. A final visual open/save check in AutoCAD, QCAD or LibreCAD is still required before declaring full desktop-CAD compatibility.
