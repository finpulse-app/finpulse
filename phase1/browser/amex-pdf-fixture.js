// Multi-page fictional statement. Contains no data from a user's PDF.
module.exports=function amexPDF(){
 const pages=[
  ['American Express Platinum Card','Cardholder name: Jane Sample','Closing Date10/31/26','Account Ending4-56789','New Balance $900.00','Minimum Payment Due $35.00','Payment Due Date11/20/26'],
  ['Payments and Credits','Summary','Payments Amount','10/02/26* Jane Sample MOBILE PAYMENT - THANK YOU -$30.00','10/03/26* Jane Sample MOBILE PAYMENT - THANK YOU -$20.00','10/04/26* Jane Sample MOBILE PAYMENT - THANK YOU -$30.00','Credits Amount','10/05/26 Jane Sample Subscription Credit -$5.00','New Charges','Summary','Total New Charges $0.00 $140.00 $140.00','Detail','10/05/26 Coffee Grove $10.25'],
  ['American Express Platinum Card','Account Ending4-56789','Detail Continued - Pay Over Time activity','10/06/26 Grocery Club $20.50','10/07/26 Online Shop $109.25','Fees','Total Fees for this Period $0.00'],
  ['Interest Charged','10/31/26 Interest Charge on Pay Over Time Purchases $5.75','Total Interest Charged for this Period $5.75','Interest Charge Calculation','Your Annual Percentage Rate (APR) is the annual interest rate.','Pay Over Time 10/31/2026 19.99% (v) $900.00 $5.75'],
  ['IMPORTANT NOTICES','Pay Over Time may apply to eligible purchases.','This is fictional software test data.']
 ];
 const escape=s=>s.replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
 const ids=pages.map((_,i)=>4+i*2),objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids ['+ids.map(id=>id+' 0 R').join(' ')+'] /Count '+pages.length+' >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 pages.forEach((lines,i)=>{const stream='BT /F1 12 Tf\n'+lines.map((line,j)=>'1 0 0 1 50 '+(750-j*25)+' Tm ('+escape(line)+') Tj').join('\n')+'\nET';objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents '+(ids[i]+1)+' 0 R >>','<< /Length '+Buffer.byteLength(stream)+' >>\nstream\n'+stream+'\nendstream');});
 let out='%PDF-1.4\n',offsets=[0];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(out));out+=(i+1)+' 0 obj\n'+o+'\nendobj\n';});const xref=Buffer.byteLength(out);out+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';return Buffer.from(out);
};
