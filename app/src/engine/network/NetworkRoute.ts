export type NetworkCoordinate = [number, number]
export interface NetworkPose {
  distance: number
  longitude: number
  latitude: number
  east: number
  north: number
}

const RADIUS = 6371008.8
const RAD = Math.PI / 180
const longitudeDelta = (degrees: number) => ((degrees + 540) % 360) - 180
const wrapLongitude = (degrees: number) => ((degrees + 540) % 360) - 180
const mercatorNorth = (latitude: number) => RADIUS * Math.log(Math.tan(Math.PI / 4 + Math.max(-89.999, Math.min(89.999, latitude)) * RAD / 2))

/** One connected source LineString. All route arithmetic stays in JS doubles. */
export class NetworkRoute {
  readonly points: NetworkCoordinate[] = []
  readonly distances: number[] = [0]
  readonly length: number

  constructor(coordinates: NetworkCoordinate[]) {
    if (!Array.isArray(coordinates) || coordinates.length < 2) throw new TypeError('铁路分量至少需要两个经纬度点')
    for (const point of coordinates) {
      if (!Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])
        || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) throw new TypeError('铁路分量包含无效经纬度')
      const previous = this.points.at(-1)
      if (previous) {
        const dLat = (point[1] - previous[1]) * RAD, dLon = longitudeDelta(point[0] - previous[0]) * RAD
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(point[1] * RAD) * Math.cos(previous[1] * RAD) * Math.sin(dLon / 2) ** 2
        const metres = 2 * RADIUS * Math.asin(Math.min(1, Math.sqrt(Math.max(0, a))))
        if (metres < .01) continue
        this.distances.push(this.distances.at(-1)! + metres)
      }
      this.points.push([point[0], point[1]])
    }
    this.length = this.distances.at(-1)!
    if (this.points.length < 2 || this.length < 1) throw new RangeError('铁路分量长度不足一米')
  }

  private coordinate(distance: number): NetworkCoordinate {
    if (distance === 0) return this.points[0]
    if (distance === this.length) return this.points.at(-1)!
    let low = 0, high = this.points.length - 2
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (this.distances[mid] <= distance) low = mid
      else high = mid - 1
    }
    const a = this.points[low], b = this.points[low + 1]
    const t = (distance - this.distances[low]) / (this.distances[low + 1] - this.distances[low])
    return [wrapLongitude(a[0] + longitudeDelta(b[0] - a[0]) * t), a[1] + (b[1] - a[1]) * t]
  }

  pose(distance: number): NetworkPose {
    if (!Number.isFinite(distance)) throw new TypeError('铁路里程必须是有限数值')
    distance = Math.max(0, Math.min(this.length, distance))
    const [longitude, latitude] = this.coordinate(distance)
    const before = this.coordinate(Math.max(0, distance - 10)), after = this.coordinate(Math.min(this.length, distance + 10))
    const east = longitudeDelta(after[0] - before[0]) * Math.cos(latitude * RAD), north = after[1] - before[1]
    const length = Math.hypot(east, north)
    return { distance, longitude, latitude, east: length ? east / length : 0, north: length ? north / length : 1 }
  }

  /** Preserve every source vertex as well as the regular mesh sample lattice. */
  samples(start: number, end: number, spacing = 16) {
    if (![start, end, spacing].every(Number.isFinite) || spacing <= 0) throw new TypeError('路线采样范围无效')
    start = Math.max(0, Math.min(this.length, start))
    end = Math.max(start, Math.min(this.length, end))
    const values = [start, end]
    for (let s = Math.ceil(start / spacing) * spacing; s < end; s += spacing) if (s > start) values.push(s)
    for (const s of this.distances) if (s > start && s < end) values.push(s)
    return [...new Set(values)].sort((a, b) => a - b)
  }

  /** Conformal local east/south frame, scaled to metres at the anchor latitude. */
  project(point: Pick<NetworkPose, 'longitude' | 'latitude'>, origin: Pick<NetworkPose, 'longitude' | 'latitude'>) {
    return {
      x: longitudeDelta(point.longitude - origin.longitude) * RAD * RADIUS * Math.cos(origin.latitude * RAD),
      z: -(mercatorNorth(point.latitude) - mercatorNorth(origin.latitude)) * Math.cos(origin.latitude * RAD),
    }
  }
}
