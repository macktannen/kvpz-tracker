const https = require('https');
https.get('https://raw.githubusercontent.com/sdr-enthusiasts/icao2reg/master/icao2reg.js', res => {
  let d = '';
  res.on('data', c => d+=c);
  res.on('end', () => console.log(d));
});
