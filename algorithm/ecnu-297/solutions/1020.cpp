#include <iostream>
#include <vector>
using namespace std;

struct Node {
    int prior, next;
};

void remove(vector<Node> &queue, int x) {
    queue[queue[x].prior].next = queue[x].next;
    queue[queue[x].next].prior = queue[x].prior;
}

void insertAfter(vector<Node> &queue, int p, int x) {
    int successor = queue[p].next;
    queue[x] = {p, successor};
    queue[p].next = x;
    queue[successor].prior = x;
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int commands, population;
    if (!(cin >> commands >> population)) return 0;
    // 0 和 population+1 是虚拟头尾，居民编号本身就是数组下标。
    int tail = population + 1;
    vector<Node> queue(population + 2);
    for (int i = 0; i <= tail; ++i) queue[i] = {i - 1, i + 1};
    while (commands--) {
        int op;
        cin >> op;
        if (op == 1) {
            int x = queue[0].next;
            remove(queue, x);
            insertAfter(queue, queue[tail].prior, x);
        } else if (op == 2) {
            int x;
            cin >> x;
            remove(queue, x);
            insertAfter(queue, 0, x);
        } else {
            cout << queue[0].next << '\n';
        }
    }
}
