'use strict';

/*
	Worker methods can return an instance of Movable to move (i.e., zero-copy)
	transferable objects within the wrapped return value.
 */

module.exports = class Movable {
	constructor(value, transferList) {
		if (!Array.isArray(transferList)) {
			throw new TypeError('Expected transferList to be an array');
		}

		this.value = value;
		this.transferList = transferList;
	}
};
