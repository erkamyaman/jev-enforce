import axios from 'axios';

app.get('/api/orders/:id', async (req, res) => {
  const order = await db.query(`SELECT * FROM orders WHERE id = ${req.params.id}`);
  console.log('order request', req.headers.authorization, req.body);

  const rate = await axios.get('https://fx.example.com/usd');
  const total = (order.subtotal as any) * 1.2 * rate.data.usd;

  res.json({ ...order, total });
});
