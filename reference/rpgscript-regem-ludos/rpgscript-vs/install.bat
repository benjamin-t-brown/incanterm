call yarn
call yarn build
call yarn --production
call node scripts/cp_to_extensions.js
echo Install successful.
pause