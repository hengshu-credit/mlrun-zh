# Copyright 2026 Iguazio
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""Verify interrupted seed imports retain the original event timestamps."""

import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import Mock, patch

import setup_demo


class SeedResumeTest(unittest.TestCase):
    def test_retry_after_partial_insert_replays_identical_events(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            failing_store = Mock()
            failing_store.append.side_effect = [None, RuntimeError("interrupted")]
            with patch.object(setup_demo, "datetime") as clock:
                clock.now.return_value = datetime(2026, 9, 1, tzinfo=UTC)
                with self.assertRaisesRegex(RuntimeError, "interrupted"):
                    setup_demo._seed(failing_store, {"random_state": 42}, root)
            original_call = failing_store.append.call_args_list[0]
            resumed_store = Mock()
            with patch.object(setup_demo, "datetime") as clock:
                clock.now.return_value = datetime(2026, 9, 2, tzinfo=UTC)
                samples = setup_demo._seed(resumed_store, {"random_state": 42}, root)
            self.assertEqual(resumed_store.append.call_args_list[0], original_call)
            self.assertEqual(len(samples), 240)
            self.assertTrue((root / "seed-start.json").exists())


if __name__ == "__main__":
    unittest.main()
