const fs = require('fs');
const path = require('path');

const imagesDir = path.join(__dirname, 'assets', 'images');

if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir, { recursive: true });
}

function createValidPNG(width, height) {
  const zlib = require('zlib');
  
  function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
      crc ^= buf[i];
      for (let j = 0; j < 8; j++) {
        if (crc & 1) {
          crc = (crc >>> 1) ^ 0xEDB88320;
        } else {
          crc >>>= 1;
        }
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    
    const typeBuf = Buffer.from(type);
    const crcData = Buffer.concat([typeBuf, data]);
    const crc = crc32(crcData);
    
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc);
    
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  
  let raw = [];
  for (let y = 0; y < height; y++) {
    raw.push(0);
    for (let x = 0; x < width; x++) {
      if (x > width*0.3 && x < width*0.7 && y > height*0.25 && y < height*0.75) {
        raw.push(200, 210, 220, 255);
      } else {
        raw.push(240, 242, 245, 255);
      }
    }
  }
  
  const idat = zlib.deflateSync(Buffer.from(raw));
  
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

try {
  const avatar = createValidPNG(200, 200);
  fs.writeFileSync(path.join(imagesDir, 'default-avatar.png'), avatar);
  console.log(`✓ default-avatar.png created (${avatar.length} bytes)`);
} catch(e) {
  console.error('Error:', e.message);
}
