// Fictional Apple Card layout: separate columns, Daily Cash, and financed hardware.
module.exports=function applePDF(){
 const pages=[
  [['Apple Card',50,750],['September 1 - September 30, 2026',50,720],['Minimum',50,675],['Due By',330,675],['$45.00',50,650],['October 31, 2026',330,650],['Minimum payment includes:',50,615],['Apple Card transactions',50,590],['$5.00',205,590],['Apple Card Monthly Installments',50,565],['$40.00',220,565],['Previous Total Balance $220.00',50,520],['Total Balance $805.00',50,495]],
  [['Payments',50,750],['Date Description Amount',50,720],['09/08/2026 ACH payment from bank account ending 8765 -$20.00',50,690],['Transactions',50,640],['Date Description Daily Cash Amount',50,610],['09/10/2026 Spotify 1% $0.15 $15.00',50,580],['09/12/2026 Coffee Grove 2% $0.10 $5.00',50,550],['09/14/2026 Harbor Fitness 1% $0.25 $25.00',50,520],['09/16/2026 Store refund 1% -$0.10 -$10.00',50,490]],
  [['Interest Charge Calculation',50,750],['Annual Percentage Rate (APR) 24.99% (variable)',50,720],['Apple Card Monthly Installments',50,660],['05/18/2026 Financed laptop $960.00',50,630],['Total financed $960.00',50,600],['Total remaining $800.00',50,570],['Monthly installment $40.00 at 0% APR',50,540],['Daily Cash',50,480],['09/10/2026 Daily Cash $0.15',50,450]]
 ];
 const esc=s=>s.replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
 const ids=pages.map((_,i)=>4+i*2),objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids ['+ids.map(id=>id+' 0 R').join(' ')+'] /Count '+pages.length+' >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 pages.forEach((items,i)=>{const stream='BT /F1 11 Tf\n'+items.map(([s,x,y])=>'1 0 0 1 '+x+' '+y+' Tm ('+esc(s)+') Tj').join('\n')+'\nET';objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents '+(ids[i]+1)+' 0 R >>','<< /Length '+Buffer.byteLength(stream)+' >>\nstream\n'+stream+'\nendstream');});
 let out='%PDF-1.4\n',offsets=[0];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(out));out+=(i+1)+' 0 obj\n'+o+'\nendobj\n';});const xref=Buffer.byteLength(out);out+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';return Buffer.from(out);
};
