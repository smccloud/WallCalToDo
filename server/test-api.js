import { listAccounts } from './src/auth/googleAuth.js';

try {
  const accounts = listAccounts();
  console.log('Found', accounts.length, 'accounts');
  
  if (accounts.length > 0) {
    const account = accounts[0];
    console.log('Account:', JSON.stringify(account, null, 2));
  } else {
    console.log('No accounts to display');
  }
} catch (err) {
  console.error('Error:', err.message);
}
