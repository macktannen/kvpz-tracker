module.exports = (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({ status: 'ok', service: 'FAA Scraper' });
};
