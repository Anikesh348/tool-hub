import java.util.HashMap;
import java.util.Map;

/**
 * Complete reference implementation for the LRU Cache LLD problem: O(1)
 * get/put via a HashMap + doubly-linked list with sentinel head/tail nodes.
 *   javac LruCacheSystem.java && java LruCacheSystem
 */
public class LruCacheSystem {

    static class Node {
        final int key;
        int value;
        Node prev, next;

        Node(int key, int value) {
            this.key = key;
            this.value = value;
        }
    }

    static class LruCache {
        private final int capacity;
        private final Map<Integer, Node> map = new HashMap<>();
        private final Node head = new Node(0, 0); // sentinel: most-recently-used side
        private final Node tail = new Node(0, 0); // sentinel: least-recently-used side

        LruCache(int capacity) {
            this.capacity = capacity;
            head.next = tail;
            tail.prev = head;
        }

        private void remove(Node node) {
            node.prev.next = node.next;
            node.next.prev = node.prev;
        }

        private void insertAtFront(Node node) {
            node.next = head.next;
            node.prev = head;
            head.next.prev = node;
            head.next = node;
        }

        int get(int key) {
            if (!map.containsKey(key)) return -1;
            Node node = map.get(key);
            remove(node);
            insertAtFront(node);
            return node.value;
        }

        void put(int key, int value) {
            if (map.containsKey(key)) {
                remove(map.get(key));
            } else if (map.size() == capacity) {
                Node lru = tail.prev;
                remove(lru);
                map.remove(lru.key);
                System.out.println("Evicted key " + lru.key);
            }
            Node node = new Node(key, value);
            map.put(key, node);
            insertAtFront(node);
        }
    }

    public static void main(String[] args) {
        LruCache cache = new LruCache(2);

        cache.put(1, 100);
        cache.put(2, 200);
        System.out.println("get(1) = " + cache.get(1)); // 100, and 1 becomes most-recently-used

        cache.put(3, 300); // capacity 2 exceeded -> evicts key 2 (least recently used)
        System.out.println("get(2) = " + cache.get(2)); // -1, evicted

        cache.put(4, 400); // evicts key 1
        System.out.println("get(1) = " + cache.get(1)); // -1, evicted
        System.out.println("get(3) = " + cache.get(3)); // 300
        System.out.println("get(4) = " + cache.get(4)); // 400
    }
}
