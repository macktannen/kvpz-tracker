async function testJsonBinPublic() {
    try {
        // Test public bin read/write on jsonbin.io
        const apiKey = '$2a$10$tJ9f.EwBqS.GzB1r7/8P4eJj9K3d8G7f6e5d4c3b2a1'; // sample master key
        const createRes = await fetch('https://api.jsonbin.io/v3/b', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': '$2a$10$7R.EwBqS.GzB1r7/8P4eJj9K3d8G7f6e5d4c3b2a1'
            },
            body: JSON.stringify({ logs: [{ id: 'op_1', tail: 'N83HS', opType: 'arrival', timestamp: Date.now() }] })
        });
        console.log('Jsonbin status:', createRes.status);
        const data = await createRes.json();
        console.log('Jsonbin data:', data);
    } catch(e) {
        console.error('Jsonbin err:', e.message);
    }
}
testJsonBinPublic();
