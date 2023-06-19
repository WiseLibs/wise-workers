'use strict';

module.exports = new Promise((resolve, reject) => {
	setTimeout(() => reject(new Error('this worker is for testing')), 10);
});
