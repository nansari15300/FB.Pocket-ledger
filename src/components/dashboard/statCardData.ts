
import {
  ShoppingBag,
  ShoppingCart,
  Landmark,
  TrendingUp,
  TrendingDown,
  BookText,
  FileDigit,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';

export const statCardData = [
  {
    title: 'Sales',
    icon: ShoppingBag,
    type: 'sale',
    link: '/sale',
    isCredit: true,
  },
  {
    title: 'Purchases',
    icon: ShoppingCart,
    type: 'purchase',
    link: '/purchase',
    isCredit: false,
  },
  {
    title: 'Receipt',
    icon: ArrowRight,
    type: 'payment_in',
    link: '/payment-in',
    isCredit: true,
  },
  {
    title: 'Payment',
    icon: ArrowLeft,
    type: 'payment_out',
    link: '/payment-out',
    isCredit: false,
  },
  {
    title: 'Contra',
    icon: Landmark,
    type: 'contra',
    link: '/contra',
    isCredit: false,
  },
  {
    title: 'Journals',
    icon: BookText,
    type: 'journal',
    link: '/journal',
    isCredit: false,
  },
  {
    title: 'Add Salary',
    icon: FileDigit,
    type: 'add_salary',
    link: '/add-salary',
    isCredit: false,
  },
  {
    title: 'Direct Income',
    icon: TrendingUp,
    type: 'direct_income',
    link: '/payment-in',
    isCredit: true,
  },
  {
    title: 'Direct Expense',
    icon: TrendingDown,
    type: 'direct_expense',
    link: '/payment-out',
    isCredit: false,
  },
];
