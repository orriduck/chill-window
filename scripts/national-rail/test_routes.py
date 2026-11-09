import unittest
from build_routes import convert_feature, verify_ids, geodesic

class RouteTests(unittest.TestCase):
    def feature(self, paths):
        return {'attributes': {'OBJECTID': 7, 'name': 'Example', 'ROUTE_URL': None}, 'geometry': {'paths': paths}}

    def test_disconnected_paths_stay_separate(self):
        f, row = convert_feature(self.feature([[[-74,40],[-74,41]],[[-120,35],[-120,36]]]))
        self.assertEqual(f['geometry']['type'], 'MultiLineString')
        self.assertEqual(len(f['geometry']['coordinates']), 2)
        self.assertEqual(row['components'], 2)
        self.assertEqual(row['segments'], 2)
        self.assertTrue(220000 < row['geodesicLengthM'] < 224000)

    def test_touching_paths_share_component_without_merging(self):
        f, row = convert_feature(self.feature([[[0,0],[1,0]],[[1,0],[2,0]]]))
        self.assertEqual(row['components'], 1)
        self.assertEqual(row['sourcePaths'], 2)
        self.assertEqual(len(f['geometry']['coordinates']), 2)

    def test_wgs84_distance_reference(self):
        self.assertAlmostEqual(geodesic([0,0],[1,0]), 111319.490793, places=3)
        self.assertEqual(geodesic([0,0],[0,0]), 0)

    def test_invalid_coordinate_rejected(self):
        for point in ([float('nan'),0], [181,0], [0,91]):
            with self.assertRaises(ValueError):
                convert_feature(self.feature([[[0,0],point]]))

    def test_missing_duplicate_or_extra_page_ids_rejected(self):
        verify_ids([1,3], [3,1], 2)
        for seen in ([1], [1,1], [1,3,4]):
            with self.assertRaises(ValueError):
                verify_ids([1,3], seen, 2)


class RideTests(unittest.TestCase):
    def test_endpoint_join_and_reverse(self):
        from build_routes import ride_components
        paths = [[[0,0],[1,0]],[[2,0],[1,0]],[[10,0],[11,0]]]
        result = ride_components(paths)
        self.assertEqual(sorted(map(len,result)), [2,3])
        self.assertIn([[0,0],[1,0],[2,0]],result)

    def test_branch_and_near_gap_not_joined(self):
        from build_routes import ride_components
        paths = [[[0,0],[1,0]],[[1,0],[2,0]],[[1,0],[1,1]],[[2.00000001,0],[3,0]]]
        self.assertEqual(len(ride_components(paths)),4)

    def test_cycle_preserves_edges(self):
        from build_routes import ride_components
        paths = [[[0,0],[1,0]],[[1,0],[1,1]],[[1,1],[0,0]]]
        result = ride_components(paths)
        self.assertEqual(len(result),1)
        self.assertEqual(result[0][0],result[0][-1])
        self.assertEqual(len(result[0]),4)

if __name__ == '__main__':
    unittest.main()
