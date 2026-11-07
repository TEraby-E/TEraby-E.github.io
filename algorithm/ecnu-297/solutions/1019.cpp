#include <iostream>
#include <vector>
using namespace std;

struct Node {
    int left, right;
};

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n;
    if (!(cin >> n)) return 0;
    vector<Node> tree(n + 1);
    for (int i = 1; i <= n; ++i) cin >> tree[i].left >> tree[i].right;

    vector<int> queue(n);
    int front = 0, rear = 0;
    queue[rear++] = 1;
    while (front < rear) {
        int node = queue[front++];
        if (front > 1) cout << ' ';
        cout << node;
        if (tree[node].left != -1) queue[rear++] = tree[node].left;
        if (tree[node].right != -1) queue[rear++] = tree[node].right;
    }
    cout << '\n';
}
