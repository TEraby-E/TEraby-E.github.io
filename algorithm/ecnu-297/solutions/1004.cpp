#include <iostream>
#include <limits>
#include <sstream>
#include <string>
#include <utility>
using namespace std;

struct Node {
    int data;
    Node *next;
};

struct Queue {
    Node *first = nullptr;
    Node *last = nullptr;
    int size = 0;

    void push(int value) {
        Node *node = new Node{value, nullptr};
        if (last == nullptr) first = node;
        else last->next = node;
        last = node;
        ++size;
    }

    void pop() {
        Node *node = first;
        first = first->next;
        if (first == nullptr) last = nullptr;
        delete node;
        --size;
    }

    void clear() {
        while (first != nullptr) pop();
    }

    void copyFrom(const Queue &other) {
        clear();
        for (Node *p = other.first; p != nullptr; p = p->next) push(p->data);
    }

    void exchange(Queue &other) {
        swap(first, other.first);
        swap(last, other.last);
        swap(size, other.size);
    }

    ~Queue() {
        clear();
    }
};

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int q;
    if (!(cin >> q)) return 0;
    Queue queues[2];
    cin.ignore(numeric_limits<streamsize>::max(), '\n');
    while (q--) {
        string line, op, name, extra;
        getline(cin, line);
        istringstream command(line);
        command >> op;
        if (op == "swap") {
            if (command >> extra) cout << "ERROR\n";
            else queues[0].exchange(queues[1]);
            continue;
        }
        command >> name;
        int value;
        if ((name != "a" && name != "b") || (op == "push" && !(command >> value)) || (command >> extra)) {
            cout << "ERROR\n";
            continue;
        }
        int index = name[0] - 'a';
        Queue &queue = queues[index];
        if (op == "push") {
            queue.push(value);
        } else if (op == "pop") {
            if (queue.size == 0) cout << "ERROR\n";
            else queue.pop();
        } else if (op == "front") {
            if (queue.size == 0) cout << "ERROR\n";
            else cout << queue.first->data << '\n';
        } else if (op == "size") {
            cout << queue.size << '\n';
        } else if (op == "clear") {
            queue.clear();
        } else if (op == "empty") {
            cout << (queue.size == 0 ? "YES" : "NO") << '\n';
        } else if (op == "operator=") {
            queues[1 - index].copyFrom(queue);
        } else {
            cout << "ERROR\n";
        }
    }
}
