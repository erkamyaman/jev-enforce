export interface Item {
  name: string;
  price: number;
  qty: number;
}

export function total(items: Item[], discountPercent: number): number {
  const subtotal = items.reduce((sum, item) => sum + item.price, 0);
  return subtotal - subtotal * discountPercent;
}
