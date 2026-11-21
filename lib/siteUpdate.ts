import * as XLSX from 'xlsx';
import { saveWorkbook } from './flowchart/excelExport';

// "Site Update" tab on the Flowchart screen (2026-11-21, client): the PMC's
// SITE UPDATE – ROAST @KOKAPET sheet of 09 Sep 2026, shown as a plain table
// (no flowchart) with an Excel download. Typed in from the printed sheet;
// it is not read from or saved to the database.

export type SiteUpdateRow = {
  sNo: number;
  description: string;
  planned: string; // yyyy-mm-dd
  estimated: string; // yyyy-mm-dd
  delayedBy: number; // as printed: negative = days late
  remark: string;
  /** On the printed sheet this remark is one cell shared with the row above. */
  remarkSameAsAbove?: boolean;
};

export type SiteUpdateGroup = { title: string; rows: SiteUpdateRow[] };

export const SITE_UPDATE = {
  title: 'SITE UPDATE- ROAST @KOKAPET',
  date: '09th SEP 2026',
  footer: 'TEAM HANDS ON PVT LTD (PMC)',
  groups: [
    {
      title: 'Milestones for +3\'-6" TO -2\'-6" levels',
      rows: [
        { sNo: 1, description: 'PCC works @ -6\'-0" & -2\'-0" levels', planned: '2026-08-17', estimated: '2026-09-09', delayedBy: -23, remark: 'Due to compactor' },
        { sNo: 2, description: '+3\'-6" level Slab casting', planned: '2026-08-22', estimated: '2026-09-15', delayedBy: -24, remark: 'Due to compactor & Shortage of work force' },
        { sNo: 3, description: 'Walls 2 & 3, 1st lift, Kitchen niche concrete casting', planned: '2026-08-23', estimated: '2026-09-19', delayedBy: -27, remark: 'Due to compactor & Shortage of work force' },
        { sNo: 4, description: 'Walls 21, 22 & 23 concrete casting', planned: '2026-08-23', estimated: '2026-09-19', delayedBy: -27, remark: 'Due to compactor & Delay in Material supply' },
        { sNo: 5, description: 'Wall 4, 1st lift till +5\'-0" level', planned: '2026-08-24', estimated: '2026-09-19', delayedBy: -26, remark: 'Delay in Material supply & Shortage of work force' },
        { sNo: 6, description: 'Walls 2 & 3, 2nd lift concrete casting', planned: '2026-08-29', estimated: '2026-09-23', delayedBy: -25, remark: 'Due to compactor & Delay in Material supply' },
        { sNo: 7, description: 'Wall 4, 2nd lift till +12\'-0" level', planned: '2026-08-29', estimated: '2026-09-25', delayedBy: -27, remark: 'Delay in Material supply & Shortage of work force' },
      ],
    },
    {
      title: 'Milestones for -4\'-6" TO -7\'-6" levels',
      rows: [
        { sNo: 1, description: 'Mivan columns casting @ -7\'-6" level', planned: '2026-08-29', estimated: '2026-09-09', delayedBy: -11, remark: 'Due to compactor & Space constraint for material storage' },
        { sNo: 2, description: 'Wall 8, 9, 10 casting till beam bottom', planned: '2026-08-24', estimated: '2026-09-15', delayedBy: -22, remark: 'Shortage of work force' },
        { sNo: 3, description: 'PCC works @ -3\'-6", -4\'-6" & -7\'-6" levels', planned: '2026-09-02', estimated: '2026-09-17', delayedBy: -15, remark: 'Due to compactor' },
        { sNo: 4, description: 'Mezzanine slab casting @ Hot kitchen GF roof slab', planned: '2026-09-10', estimated: '2026-09-27', delayedBy: -17, remark: 'Delay in Material supply & Shortage of work force' },
        { sNo: 5, description: '2\'-0" Starter casting for mezzanine floor, Hot kitchen @ 1st floor columns & toilet wall', planned: '2026-09-16', estimated: '2026-10-01', delayedBy: -15, remark: 'Delay in Material supply & Shortage of work force', remarkSameAsAbove: true },
        { sNo: 6, description: 'Toilet wall, columns @ mezzanine casting till beam bottom', planned: '2026-09-21', estimated: '2026-10-17', delayedBy: -26, remark: 'Delay in Material supply & Shortage of work force', remarkSameAsAbove: true },
        { sNo: 7, description: 'Staircase concrete casting', planned: '2026-09-21', estimated: '2026-10-17', delayedBy: -26, remark: 'Delay in Material supply & Shortage of work force', remarkSameAsAbove: true },
        { sNo: 8, description: 'Roof beam casting', planned: '2026-09-26', estimated: '2026-10-18', delayedBy: -22, remark: 'Delay in Material supply & Shortage of work force', remarkSameAsAbove: true },
      ],
    },
  ] as SiteUpdateGroup[],
};

export const SITE_UPDATE_HEADERS = ['S.NO', 'DESCRIPTION', 'PLANNED DATE', 'ESTIMATED DATE', 'DELAYED BY', 'REMARKS'];

/** dd/mm/yy, as printed on the sheet. */
export function sheetDate(key: string): string {
  return `${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(2, 4)}`;
}

function dateCell(key: string): XLSX.CellObject {
  const [y, m, d] = key.split('-').map(Number);
  return { t: 'd', v: new Date(y, m - 1, d), z: 'dd/mm/yy' };
}

export function buildSiteUpdateWorkbook(): XLSX.WorkBook {
  const s = (v: string): XLSX.CellObject => ({ t: 's', v });
  const aoa: XLSX.CellObject[][] = [[s(`DATE: ${SITE_UPDATE.date}`), s(''), s(SITE_UPDATE.title)], []];
  const merges: XLSX.Range[] = [{ s: { r: 0, c: 2 }, e: { r: 0, c: 5 } }];

  for (const group of SITE_UPDATE.groups) {
    merges.push({ s: { r: aoa.length, c: 0 }, e: { r: aoa.length, c: 5 } });
    aoa.push([s(group.title)]);
    aoa.push(SITE_UPDATE_HEADERS.map(s));
    let remarkStart = -1;
    group.rows.forEach((row, i) => {
      const r = aoa.length;
      aoa.push([
        { t: 'n', v: row.sNo },
        s(row.description),
        dateCell(row.planned),
        dateCell(row.estimated),
        { t: 'n', v: row.delayedBy },
        s(row.remarkSameAsAbove ? '' : row.remark),
      ]);
      // One shared REMARKS cell, like the printed sheet.
      if (!row.remarkSameAsAbove) remarkStart = r;
      const next = group.rows[i + 1];
      if (!next?.remarkSameAsAbove && r > remarkStart) merges.push({ s: { r: remarkStart, c: 5 }, e: { r, c: 5 } });
    });
    aoa.push([]);
  }
  aoa.push([s(SITE_UPDATE.footer)]);

  const sheet = XLSX.utils.aoa_to_sheet(aoa as unknown as unknown[][], { cellDates: true });
  sheet['!merges'] = merges;
  sheet['!cols'] = [{ wch: 7 }, { wch: 60 }, { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 52 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Site Update');
  return book;
}

/** Downloads the sheet as .xlsx. Returns a note to show ('' = nothing to add). */
export function downloadSiteUpdateExcel(): Promise<string> {
  return saveWorkbook(buildSiteUpdateWorkbook(), 'Site Update - ROAST @KOKAPET - 09 Sep 2026', 'Site Update (Excel)');
}
