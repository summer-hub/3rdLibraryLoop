/**
 * doc-store.js — 文档仓库抽象接口
 *
 * 定义文档存储的统一接口（write / read / delete / list），
 * 使存储方式可插拔（目录、zip、内存等），上层不感知具体实现。
 */

/**
 * @typedef {Object} DocStore
 * @property {(documentId:string, content:string) => Promise<void>} write
 * @property {(documentId:string) => Promise<string|null>} read
 * @property {(documentId:string) => Promise<void>} delete
 * @property {() => Promise<string[]>} list
 */

export default class DocStore {
  /** @param {string} _documentId @param {string} _content */
  async write(_documentId, _content) {
    throw new Error('DocStore.write() not implemented');
  }

  /** @param {string} _documentId @returns {Promise<string|null>} */
  async read(_documentId) {
    throw new Error('DocStore.read() not implemented');
  }

  /** @param {string} _documentId */
  async delete(_documentId) {
    throw new Error('DocStore.delete() not implemented');
  }

  /** @returns {Promise<string[]>} */
  async list() {
    throw new Error('DocStore.list() not implemented');
  }
}
