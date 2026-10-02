"""Read-only Calc export using the workbook's print layout, over a local UNO pipe.

Runs as the existing sandboxed decoder UID, without credentials or IP sockets.
Only the loaded in-memory copy receives fallback print ranges. Never save it.
"""
import json
import subprocess
import sys
import time
import uuid
from pathlib import Path
import uno


def property_value(name, value):
    item = uno.createUnoStruct('com.sun.star.beans.PropertyValue')
    item.Name, item.Value = name, value
    return item


def export_workbook(source, output, profile):
    pipe = 'preview_' + uuid.uuid4().hex
    process = subprocess.Popen([
        'libreoffice', '-env:UserInstallation=' + profile.as_uri(), '--headless',
        '--nologo', '--nodefault', '--norestore', '--nofirststartwizard',
        '--accept=pipe,name=' + pipe + ';urp;StarOffice.ServiceManager',
    ], stdout=subprocess.DEVNULL, stderr=sys.stderr)
    document = None
    desktop = None
    try:
        context = uno.getComponentContext()
        resolver = context.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', context)
        deadline = time.monotonic() + 20
        while True:
            try:
                remote = resolver.resolve('uno:pipe,name=' + pipe + ';urp;StarOffice.ComponentContext')
                break
            except Exception:
                if process.poll() is not None or time.monotonic() >= deadline:
                    raise RuntimeError('Calc preview service did not start')
                time.sleep(.1)
        desktop = remote.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', remote)
        document = desktop.loadComponentFromURL(source.as_uri(), '_blank', 0, tuple(
            property_value(name, value) for name, value in {
                'Hidden': True, 'ReadOnly': True, 'Silent': True,
                'MacroExecutionMode': uno.getConstantByName('com.sun.star.document.MacroExecMode.NEVER_EXECUTE'),
                'UpdateDocMode': uno.getConstantByName('com.sun.star.document.UpdateDocMode.NO_UPDATE'),
                'FilterName': 'Calc MS Excel 2007 XML' if source.suffix.lower() == '.xlsx' else 'MS Excel 97',
            }.items()))
        if document is None or not document.supportsService('com.sun.star.sheet.SpreadsheetDocument'):
            raise RuntimeError('File is not a spreadsheet')
        # Preserve cached formula values when available; do not recalculate
        # external/volatile formulas as a side effect of generating a preview.
        document.enableAutomaticCalculation(False)
        sheets = document.getSheets()
        if sheets.getCount() > 100:
            raise RuntimeError('Workbook sheet limit exceeded')
        styles = document.getStyleFamilies().getByName('PageStyles')
        total_area = 0
        for index in range(sheets.getCount()):
            sheet = sheets.getByIndex(index)
            if not sheet.IsVisible:
                continue  # Never reveal hidden worksheets by forcing whole-sheet export.
            ranges = sheet.getPrintAreas()
            defined = bool(ranges)
            if not ranges:
                # Query populated cells, not formatting-only cells extending far
                # beyond the data. Keep merged cells that overlap the data.
                content = sheet.queryContentCells(1 | 2 | 4 | 16).getRangeAddresses()
                if content:
                    area = uno.createUnoStruct('com.sun.star.table.CellRangeAddress')
                    area.Sheet = index
                    area.StartColumn = min(r.StartColumn for r in content)
                    area.StartRow = min(r.StartRow for r in content)
                    area.EndColumn = max(r.EndColumn for r in content)
                    area.EndRow = max(r.EndRow for r in content)
                    cursor = sheet.createCursorByRange(sheet.getCellRangeByPosition(
                        area.StartColumn, area.StartRow, area.EndColumn, area.EndRow))
                    cursor.collapseToMergedArea()
                    ranges = (cursor.getRangeAddress(),)
                else:
                    # Preserve image/chart-only sheets using Calc's used range.
                    cursor = sheet.createCursor()
                    cursor.gotoEndOfUsedArea(True)
                    ranges = (cursor.getRangeAddress(),)
                sheet.setPrintAreas(ranges)
            total_area += sum((r.EndColumn - r.StartColumn + 1) * (r.EndRow - r.StartRow + 1) for r in ranges)
            if total_area > 2000000:
                raise RuntimeError('Workbook printable range limit exceeded')
            style = styles.getByName(sheet.PageStyle)
            # Do not rewrite page styles: orientation, size, margins, scaling,
            # print titles/grid, manual breaks and page order stay as imported.
            print(json.dumps({'operation': 'spreadsheet_layout', 'sheet_index': index,
                'print_area': 'defined' if defined else 'used_range', 'ranges': len(ranges),
                'landscape': style.IsLandscape, 'paper_width': style.Width, 'paper_height': style.Height,
                'scale_percent': style.PageScale, 'fit_width': style.ScaleToPagesX, 'fit_height': style.ScaleToPagesY}), flush=True)
        export_options = tuple(property_value(name, value) for name, value in {
            'PageRange': '1-200', 'SinglePageSheets': False, 'ExportBookmarks': True,
            'ExportFormFields': False, 'ExportNotes': False,
        }.items())
        document.storeToURL((output / 'source.pdf').as_uri(), (
            property_value('FilterName', 'calc_pdf_Export'),
            property_value('FilterData', export_options), property_value('Overwrite', True),
        ))
    finally:
        if document is not None:
            try: document.close(True)
            except Exception: pass
        if desktop is not None:
            try: desktop.terminate()
            except Exception: pass
        if process.poll() is None:
            process.terminate()
        try: process.wait(timeout=3)
        except subprocess.TimeoutExpired: process.kill(); process.wait()


if __name__ == '__main__':
    try:
        export_workbook(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
    except Exception as error:
        print(json.dumps({'operation': 'spreadsheet_export_failed', 'type': type(error).__name__, 'message': str(error)}), file=sys.stderr)
        sys.exit(1)
