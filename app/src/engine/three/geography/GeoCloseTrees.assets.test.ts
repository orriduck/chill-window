import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Box3, Matrix4, Quaternion, Vector3 } from 'three'

interface Accessor { bufferView: number; byteOffset?: number; count: number; componentType: number; type: string }
interface Node { mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }
interface Document {
  scene?: number; scenes: { nodes: number[] }[]; nodes: Node[];
  meshes: { primitives: { attributes: { POSITION: number }; indices: number }[] }[];
  accessors: Accessor[]; bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers: { byteLength: number; uri?: string }[]; images?: { bufferView: number; uri?: string }[];
}

describe('delivered close-tree assets', () => {
  for (const name of ['mature-scots-pine', 'oak-street-tree']) it(`${name} keeps its reviewed metre-scale bounds and local buffers`, () => {
    const directory = new URL('../../../../public/models/trees/', import.meta.url)
    const metadata = JSON.parse(readFileSync(new URL(`${name}.provenance.json`, directory), 'utf8'))
    const data = readFileSync(new URL(metadata.asset, directory))
    expect(createHash('sha256').update(data).digest('hex')).toBe(metadata.processedSha256)
    expect(data.byteLength).toBe(metadata.processedBytes)
    expect(data.toString('ascii', 0, 4)).toBe('glTF')
    expect(data.readUInt32LE(4)).toBe(2)
    expect(data.readUInt32LE(8)).toBe(data.length)
    const jsonLength = data.readUInt32LE(12), binaryOffset = 20 + jsonLength + 8
    const doc = JSON.parse(data.toString('utf8', 20, 20 + jsonLength)) as Document
    expect(data.toString('ascii', 20 + jsonLength + 4, binaryOffset)).toBe('BIN\0')
    expect(doc.buffers.every(buffer => !buffer.uri)).toBe(true)
    expect(doc.images?.every(image => !image.uri) ?? true).toBe(true)
    let triangles = 0
    const bounds = new Box3()
    const visit = (index: number, parent: Matrix4) => {
      const node = doc.nodes[index]
      const local = node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(
        new Vector3().fromArray(node.translation ?? [0, 0, 0]),
        new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
        new Vector3().fromArray(node.scale ?? [1, 1, 1]),
      )
      const world = parent.clone().multiply(local)
      if (node.mesh !== undefined) for (const primitive of doc.meshes[node.mesh].primitives) {
        const position = doc.accessors[primitive.attributes.POSITION]
        expect(position.componentType).toBe(5126); expect(position.type).toBe('VEC3')
        const view = doc.bufferViews[position.bufferView]
        const offset = binaryOffset + (view.byteOffset ?? 0) + (position.byteOffset ?? 0)
        const stride = view.byteStride ?? 12
        for (let i = 0; i < position.count; i++) {
          const point = new Vector3(data.readFloatLE(offset + i * stride), data.readFloatLE(offset + i * stride + 4), data.readFloatLE(offset + i * stride + 8)).applyMatrix4(world)
          expect(point.toArray().every(Number.isFinite)).toBe(true)
          bounds.expandByPoint(point)
        }
        const indices = doc.accessors[primitive.indices], indexView = doc.bufferViews[indices.bufferView]
        const indexOffset = binaryOffset + (indexView.byteOffset ?? 0) + (indices.byteOffset ?? 0)
        expect([5123, 5125]).toContain(indices.componentType)
        for (let i = 0; i < indices.count; i++) {
          const value = indices.componentType === 5123 ? data.readUInt16LE(indexOffset + i * 2) : data.readUInt32LE(indexOffset + i * 4)
          expect(value).toBeLessThan(position.count)
        }
        triangles += indices.count / 3
      }
      for (const child of node.children ?? []) visit(child, world)
    }
    for (const root of doc.scenes[doc.scene ?? 0].nodes) visit(root, new Matrix4())
    expect(triangles).toBe(metadata.conversion.trianglesAfter)
    for (const [actual, expected] of [[bounds.min.toArray(), metadata.sourceMeasurements.processedBoundsMetresXYZ.min], [bounds.max.toArray(), metadata.sourceMeasurements.processedBoundsMetresXYZ.max]]) {
      actual.forEach((value: number, index: number) => expect(value).toBeCloseTo(expected[index], 3))
    }
  })
})
