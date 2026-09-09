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
"""Integration tests use PostgreSQL temporary tables and leave no test records."""

import importlib.util
import json
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path


class EventFeaturesTest(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(importlib.util.find_spec("event_features"))
        import event_features

        self.module = event_features
        self.config = json.loads(Path(__file__).with_name("config.json").read_text())
        self.store = event_features.EventStore(self.config, temporary=True)
        self.store.initialize()
        self.cutoff = datetime(2026, 9, 1, 12, tzinfo=UTC)

    def tearDown(self):
        if hasattr(self, "store"):
            self.store.close()

    def event(self, event_id, age_seconds, event_type="payment", amount=10):
        return {
            "event_id": event_id,
            "user_id": "u1",
            "order_id": "o1",
            "event_type": event_type,
            "amount": amount,
            "event_time": (self.cutoff - timedelta(seconds=age_seconds)).isoformat(),
        }

    def seed(self, event, received_at=None):
        self.store.append(
            [event], received_at=received_at or self.cutoff - timedelta(seconds=1)
        )

    def query(self, **kwargs):
        return self.store.query(
            user_id="u1", order_id="o1", as_of=self.cutoff, **kwargs
        )

    def test_exact_window_boundaries_and_future_exclusion(self):
        for age in [3601, 3600, 1, 0, -1]:
            self.seed(self.event(str(age), age))
        values = self.query()
        self.assertEqual(values["user_payment_count_1h"], 2)
        self.assertEqual(values["user_payment_sum_24h"], 30)

    def test_late_arrival_visibility(self):
        self.seed(self.event("late", 60), self.cutoff + timedelta(hours=1))
        self.assertEqual(self.query()["user_payment_count_1h"], 0)
        self.assertEqual(
            self.query(visibility="event_time")["user_payment_count_1h"], 1
        )

    def test_duplicate_is_idempotent_and_conflict_is_rejected(self):
        event = self.event("duplicate", 20)
        self.seed(event)
        self.seed(event)
        self.assertEqual(self.query()["user_payment_count_1h"], 1)
        event["amount"] = 100
        with self.assertRaisesRegex(ValueError, "event_id"):
            self.seed(event)
        self.assertEqual(self.query()["user_payment_sum_24h"], 10)

    def test_batch_rolls_back_on_conflict(self):
        self.seed(self.event("old", 20))
        with self.assertRaises(ValueError):
            self.store.append(
                [self.event("new", 10), self.event("old", 20, amount=100)],
                received_at=self.cutoff - timedelta(seconds=1),
            )
        self.assertEqual(self.query()["user_payment_count_1h"], 1)

    def test_entities_and_event_types_do_not_mix(self):
        self.seed(self.event("item", 20, event_type="item", amount=25))
        other = self.event("other", 20)
        other.update(user_id="u2", order_id="o2")
        self.seed(other)
        values = self.query()
        self.assertEqual(values["user_payment_count_1h"], 0)
        self.assertEqual(values["order_item_sum_24h"], 25)

    def test_window_expires_without_new_events(self):
        self.seed(self.event("expires", 3599))
        values = self.store.query(
            user_id="u1", order_id="o1", as_of=self.cutoff + timedelta(seconds=2)
        )
        self.assertEqual(values["user_payment_count_1h"], 0)

    def test_naive_time_and_client_received_at_are_rejected(self):
        event = self.event("invalid", 10)
        event["event_time"] = "2026-09-01T12:00:00"
        with self.assertRaisesRegex(ValueError, "timezone"):
            self.seed(event)
        event = self.event("invalid2", 10)
        event["received_at"] = "2020-01-01T00:00:00Z"
        with self.assertRaisesRegex(ValueError, "received_at"):
            self.seed(event)


if __name__ == "__main__":
    unittest.main()
