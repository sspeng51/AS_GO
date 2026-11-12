from pathlib import Path
p=Path('outputs/merged500/build.mjs');s=p.read_text(encoding='utf-8');s=s.replace('w.recalculate();',"""q.getRange('B1:B7001').format.columnWidth=40;q.getRange('D2:D7001').format.wrapText=true;q.getRange('A2:O7001').format.rowHeight=65;
e.getRange('C1:C9281').format.columnWidth=40;e.getRange('E1:E9281').format.columnWidth=40;e.getRange('A2:P9281').format.rowHeight=90;for(const c of ['D','G','H','K','L'])e.getRange(`${c}2:${c}9281`).format.wrapText=true;
w.recalculate();""");p.write_text(s,encoding='utf-8')
